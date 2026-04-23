from typing import Any

from mitmproxy import ctx

from ..i18n_cert import build_cert_template_vars


def _handle_cert_serve(monitor: Any, flow: Any, Response: Any) -> None:
    try:
        import os

        confdir = os.environ.get("MITMPROXY_CONFDIR")
        cert_path_pem = os.path.join(confdir, "relaycraft-ca-cert.pem") if confdir else None
        cert_path_crt = os.path.join(confdir, "relaycraft-ca-cert.crt") if confdir else None

        path = flow.request.path.split("?")[0]

        if path in ("/cert", "/cert.pem"):
            if cert_path_pem and os.path.exists(cert_path_pem):
                with open(cert_path_pem, "rb") as file_handle:
                    content = file_handle.read()
                flow.response = Response.make(
                    200,
                    content,
                    {
                        "Content-Type": "application/x-pem-file",
                        "Content-Disposition": 'attachment; filename="relaycraft-ca-cert.pem"',
                        "Access-Control-Allow-Origin": "*",
                    },
                )
            else:
                flow.response = Response.make(404, b"Certificate not found", {"Access-Control-Allow-Origin": "*"})
            return

        if path == "/cert.crt":
            target = cert_path_crt if (cert_path_crt and os.path.exists(cert_path_crt)) else cert_path_pem
            file_name = "relaycraft-ca-cert.crt"
            if target and os.path.exists(target):
                with open(target, "rb") as file_handle:
                    content = file_handle.read()
                flow.response = Response.make(
                    200,
                    content,
                    {
                        "Content-Type": "application/x-x509-ca-cert",
                        "Content-Disposition": f'attachment; filename="{file_name}"',
                        "Access-Control-Allow-Origin": "*",
                    },
                )
            else:
                flow.response = Response.make(404, b"Certificate not found", {"Access-Control-Allow-Origin": "*"})
            return

        try:
            proxy_host = flow.request.host if flow.request.host != "relay.guide" else "127.0.0.1"
            current_port = (
                ctx.options.listen_port
                if (hasattr(ctx, "options") and hasattr(ctx.options, "listen_port"))
                else 9090
            )
            proxy_addr = f"{proxy_host}:{current_port}"
        except Exception as e:
            monitor.logger.debug(f"Failed to get proxy address, using default: {e}")
            proxy_addr = "127.0.0.1:9090"

        template_vars = build_cert_template_vars(
            flow.request.headers.get("accept-language", ""),
            flow.request.headers.get("user-agent", ""),
            proxy_addr,
        )

        try:
            import string

            assets_dir = os.path.join(os.path.dirname(__file__), "..", "assets")
            template_path = os.path.join(os.path.abspath(assets_dir), "cert_landing.html")
            with open(template_path, "r", encoding="utf-8") as file_handle:
                template_str = file_handle.read()
            html_content = string.Template(template_str).safe_substitute(template_vars)
        except Exception as template_err:
            monitor.logger.error(f"Template loading error: {template_err}")
            html_content = "<h1>RelayCraft</h1><p>Setup Guide (Template Error)</p><p><a href='/cert'>Download Certificate</a></p>"

        flow.response = Response.make(
            200,
            html_content.encode("utf-8"),
            {"Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*"},
        )
    except Exception as e:
        flow.response = Response.make(500, str(e).encode("utf-8"), {"Access-Control-Allow-Origin": "*"})
