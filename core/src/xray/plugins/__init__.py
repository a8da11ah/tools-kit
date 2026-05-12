from . import dns as _dns  # noqa: F401
from . import http as _http  # noqa: F401
from . import mqtt as _mqtt  # noqa: F401
from . import redis as _redis  # noqa: F401
from . import smtp as _smtp  # noqa: F401
from . import ssh as _ssh  # noqa: F401
from . import tls as _tls  # noqa: F401
from . import tcp as _tcp  # noqa: F401  (registers both tcp + udp)
from . import ws as _ws  # noqa: F401
from . import pgsql as _pgsql  # noqa: F401
from . import mysql as _mysql  # noqa: F401
from . import fuzz as _fuzz  # noqa: F401  (must be after http)
from .base import REGISTRY, Protocol, register

__all__ = ["REGISTRY", "Protocol", "register"]
