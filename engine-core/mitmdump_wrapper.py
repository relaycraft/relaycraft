"""
mitmproxy wrapper script
This is the entry point for the packaged mitmproxy executable
"""
import sys
import os

# Enable unbuffered output for real-time logging
# This ensures logs appear immediately without delay
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

from mitmproxy.tools import main

if __name__ == '__main__':
    # Get the directory where the executable is located
    if getattr(sys, 'frozen', False):
        # Running as compiled executable
        bundle_dir = sys._MEIPASS
    else:
        # Running as script
        bundle_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Determine confdir (prioritize environment variable)
    confdir = os.environ.get('MITMPROXY_CONFDIR', '~/.mitmproxy')
    
    # Prepare arguments
    args = [
        'mitmdump',
        '--listen-port', '8080',
        '--set', f'confdir={confdir}',
        '--set', 'flow_detail=2',
    ]
    
    # Add any additional arguments passed to the script
    args.extend(sys.argv[1:])
    
    # Replace sys.argv for mitmproxy
    sys.argv = args
    
    # Run mitmproxy
    main.mitmdump()
