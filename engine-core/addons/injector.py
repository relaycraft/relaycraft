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
    def _rc_record_hit(flow, script_path):
        try:
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
        except Exception as e:
            print(f"[RELAYCRAFT] _rc_record_hit error: {e}", flush=True)
except Exception as e:
    print(f"[RELAYCRAFT] Failed to setup _rc_record_hit: {e}", flush=True)
    def _rc_record_hit(flow, script_path): pass

# Robust logging helper for scripts
def _rc_log(level, msg):
    '''Unified logging that works with or without mitmproxy context'''
    try:
        from mitmproxy import ctx as _ctx
        if hasattr(_ctx, 'log') and hasattr(_ctx.log, level):
            getattr(_ctx.log, level)(f"[SCRIPT] {msg}")
            return
    except Exception:
        pass
    # Fallback to print with flush for immediate output
    print(f"[RELAYCRAFT][SCRIPT][{level.upper()}] {msg}", flush=True)
"""
        try:
            helper_ast = ast.parse(helper_code).body

            # Preserve module docstring if present
            # A docstring is the first statement and is a constant string expression
            docstring_stmt = None
            if (node.body and
                isinstance(node.body[0], ast.Expr) and
                isinstance(node.body[0].value, ast.Constant) and
                isinstance(node.body[0].value.value, str)):
                docstring_stmt = node.body[0]
                remaining_body = node.body[1:]
                node.body = [docstring_stmt] + helper_ast + remaining_body
            else:
                node.body = helper_ast + node.body
        except Exception as e:
            # Log the error but continue with original code
            print(f"[RELAYCRAFT] Failed to inject helper code: {e}", flush=True)

        self.generic_visit(node)
        return node

    def _create_safe_call(self, flow_param):
        """Create a safe try-except wrapped call:
        try: _rc_record_hit(flow, __file__); except Exception as e: print(f"Error: {e}")
        """
        return ast.Try(
            body=[
                ast.Expr(value=ast.Call(
                    func=ast.Name(id='_rc_record_hit', ctx=ast.Load()),
                    args=[
                        ast.Name(id=flow_param, ctx=ast.Load()),
                        ast.Name(id='__file__', ctx=ast.Load())
                    ],
                    keywords=[]
                ))
            ],
            handlers=[ast.ExceptHandler(
                type=ast.Name(id='Exception', ctx=ast.Load()),
                name='e',
                body=[
                    ast.Expr(value=ast.Call(
                        func=ast.Name(id='print', ctx=ast.Load()),
                        args=[ast.Constant(value='[RELAYCRAFT] Failed to record script hit: '), ast.Name(id='e', ctx=ast.Load())],
                        keywords=[]
                    ))
                ]
            )],
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



def inject_tracking(source_code, script_path=None):
    """
    Inject record_hit() calls into script hooks.
    Returns the modified source code.
    If script_path is provided, errors will include the path for debugging.
    """
    path_info = f" ({script_path})" if script_path else ""
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
            result = ast.unparse(new_tree)
            if injector.injected_count > 0:
                print(f"[RELAYCRAFT] Successfully injected {injector.injected_count} tracking call(s) into script{path_info}", flush=True)
            return result
        else:
            # Fallback for older python (should not happen in our env)
            print(f"[RELAYCRAFT] Warning: Python < 3.9, skipping AST injection{path_info}", flush=True)
            return source_code

    except SyntaxError as e:
        # Script has syntax errors - this is critical
        print(f"[RELAYCRAFT] Syntax error in script{path_info}: {e}", flush=True)
        return source_code
    except Exception as e:
        # Other AST errors
        print(f"[RELAYCRAFT] AST Injection failed{path_info}: {type(e).__name__}: {e}", flush=True)
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
