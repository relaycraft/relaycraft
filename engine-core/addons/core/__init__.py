__all__ = ["CoreAddon"]


def __getattr__(name):
    if name == "CoreAddon":
        from .main import CoreAddon
        return CoreAddon
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
