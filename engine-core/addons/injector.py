#!/usr/bin/env python3
"""
Script Injector for RelayCraft
Automatically injects record_hit() calls into user scripts for tracking.
This runs once during proxy startup, not per-request.
"""

import sys
import ast
import argparse


class TrackingInjector(ast.NodeTransformer):
    """AST transformer to inject record_hit calls into hook functions"""

    def __init__(self):
        self.hooks = {'request', 'response', 'error', 'websocket_message'}
        self.injected_count = 0

    def visit_Module(self, node):
        """Inject helper function at module level with deduplication logic"""
        helper_code = """
try:
    import os
    import time
    def __rc_record_hit(flow, script_path):
        if not hasattr(flow, "_relaycraft_script_hits"):
            flow._relaycraft_script_hits = []
        script_name = os.path.basename(script_path)
        hit_id = "script:" + script_name
        # Check for duplicate
        for existing in flow._relaycraft_script_hits:
            if existing.get("id") == hit_id:
                return
        # Add structured hit info
        flow._relaycraft_script_hits.append({
            "id": hit_id,
            "name": script_name,
            "type": "script",
            "status": "success",
            "timestamp": time.time()
        })
except:
    def __rc_record_hit(flow, script_path): pass
"""
        try:
            helper_ast = ast.parse(helper_code).body
            node.body = helper_ast + node.body
        except Exception:
            pass

        self.generic_visit(node)
        return node

    def _create_safe_call(self, flow_param):
        """Create a safe try-except wrapped call:
        try: __rc_record_hit(flow, __file__); except: pass
        """
        return ast.Try(
            body=[
                ast.Expr(value=ast.Call(
                    func=ast.Name(id='__rc_record_hit', ctx=ast.Load()),
                    args=[
                        ast.Name(id=flow_param, ctx=ast.Load()),
                        ast.Name(id='__file__', ctx=ast.Load())
                    ],
                    keywords=[]
                ))
            ],
            handlers=[ast.ExceptHandler(type=None, name=None, body=[ast.Pass()])],
            orelse=[],
            finalbody=[]
        )

    def _inject_into_function(self, func_node):
        """Inject tracking call into semantics-relevant locations"""
        args = func_node.args.args
        if not args: return func_node

        # 1. Identify flow parameter (auto-detect position)
        flow_param = args[1].arg if len(args) >= 2 else args[0].arg

        safe_call = self._create_safe_call(flow_param)
        injected_in_if = False

        # 2. Inject into every top-level IF block (semantic matching)
        for stmt in func_node.body:
            if isinstance(stmt, ast.If):
                stmt.body.insert(0, safe_call)
                injected_in_if = True
                self.injected_count += 1

        # 3. Fallback: Inject at top if no IF blocks found (global script)
        if not injected_in_if:
            func_node.body.insert(0, safe_call)
            self.injected_count += 1

        return func_node

    def visit_FunctionDef(self, node):
        """Visit function definitions"""
        if node.name in self.hooks:
            self._inject_into_function(node)

        self.generic_visit(node)
        return node

    def visit_AsyncFunctionDef(self, node):
        """Visit async function definitions"""
        if node.name in self.hooks:
            self._inject_into_function(node)

        self.generic_visit(node)
        return node

    def visit_Call(self, node):
        """Inject [SCRIPT] prefix into logging calls"""
        if isinstance(node.func, ast.Attribute):
            # Check for ctx.log.info/warn/error/warning
            is_log_call = False
            if node.func.attr in {'info', 'warn', 'error', 'warning', 'debug'}:
                # Check if parent is 'log'
                if isinstance(node.func.value, ast.Attribute) and node.func.value.attr == 'log':
                    is_log_call = True

            if is_log_call and len(node.args) > 0:
                # Prepend "[SCRIPT] " to the first argument
                # We use string concatenation: "[SCRIPT] " + original_msg

                original_msg = node.args[0]

                # Create a new binary operation node: "[SCRIPT] " + msg
                new_arg = ast.BinOp(
                    left=ast.Constant(value="[SCRIPT] "),
                    op=ast.Add(),
                    right=original_msg
                )

                # Replace the argument
                node.args[0] = new_arg

        self.generic_visit(node)
        return node



def inject_tracking(source_code):
    """
    Inject record_hit() calls into script hooks.
    Returns the modified source code.
    """
    try:
        # Parse source code
        tree = ast.parse(source_code)

        # Transform AST
        injector = TrackingInjector()
        new_tree = injector.visit(tree)

        # Fix missing locations
        ast.fix_missing_locations(new_tree)

        # Unparse back to source (Requires Python 3.9+)
        if sys.version_info >= (3, 9):
            return ast.unparse(new_tree)
        else:
            # Fallback for older python (should not happen in our env)
            return source_code

    except Exception as e:
        # print(f"AST Injection failed: {e}")
        return source_code

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Inject tracking code into RelayCraft scripts')
    parser.add_argument('input_file', help='Input script file')
    parser.add_argument('output_file', help='Output script file')

    args = parser.parse_args()

    try:
        with open(args.input_file, 'r', encoding='utf-8') as f:
            content = f.read()

        modified = inject_tracking(content)

        with open(args.output_file, 'w', encoding='utf-8') as f:
            f.write(modified)

        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
