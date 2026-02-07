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
        self.injected = []
    
    def visit_Module(self, node):
        """Inject helper function at module level"""
        helper_code = """
try:
    import os
    def record_hit(flow):
        if not hasattr(flow, "_relaycraft_script_hits"):
            flow._relaycraft_script_hits = []
        flow._relaycraft_script_hits.append("script:" + os.path.basename(__file__))
except:
    def record_hit(flow): pass
"""
        try:
            helper_ast = ast.parse(helper_code).body
            node.body = helper_ast + node.body
        except Exception as e:
            pass # Should not happen
            
        self.generic_visit(node)
        return node

    def visit_FunctionDef(self, node):
        """Visit function definitions"""
        if node.name in self.hooks:
            self._inject_into_function(node)
            self.injected.append(node.name)
        
        self.generic_visit(node)
        return node
    
    def visit_AsyncFunctionDef(self, node):
        """Visit async function definitions"""
        if node.name in self.hooks:
            self._inject_into_function(node)
            self.injected.append(node.name)
        
        self.generic_visit(node)
        return node
    
    def _inject_into_function(self, func_node):
        """Inject record_hit into a function's first conditional branch"""
        # Look for the first If statement in the function body
        for i, stmt in enumerate(func_node.body):
            if isinstance(stmt, ast.If):
                # Found first if statement - inject at the start of its body
                record_hit_call = self._create_record_hit_call(func_node)
                
                # Insert at the beginning of the if body
                stmt.body.insert(0, record_hit_call)
                return func_node
        
        # No if statement found - don't inject (script might not have conditions)
        return func_node
    
    def _create_record_hit_call(self, func_node):
        """Create AST node for: record_hit(flow)"""
        flow_param = self._get_flow_param_name(func_node)
        
        # Create: record_hit(flow)
        return ast.Expr(
            value=ast.Call(
                func=ast.Name(id='record_hit', ctx=ast.Load()),
                args=[ast.Name(id=flow_param, ctx=ast.Load())],
                keywords=[]
            )
        )
    
    def _get_flow_param_name(self, func_node):
        """Get the name of the flow parameter"""
        # For instance methods: def request(self, flow) -> 'flow'
        # For module functions: def request(flow) -> 'flow'
        args = func_node.args.args
        if len(args) >= 2:
            # Instance method - second param is flow
            return args[1].arg
        elif len(args) >= 1:
            # Module function - first param is flow
            return args[0].arg
        else:
            # Fallback
            return 'flow'

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
