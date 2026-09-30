"""Verify model initialization and real inference while all outgoing sockets fail."""
import json
from pathlib import Path
import socket
from unittest.mock import patch

from interpreter import Embeddings, Interpreter

attempts = []


def reject(*_args, **_kwargs):
    attempts.append("outgoing connection attempted")
    raise RuntimeError("Network disabled during inference verification")


with patch.object(socket.socket, "connect", reject), patch.object(socket, "create_connection", reject):
    engine = Interpreter(Embeddings())
    result = engine.interpret("腰を下ろして休めるもの")
    assert result["spec"]["object"] == "chair"
    assert not attempts
print(json.dumps({"ok": True, "modelAndInferenceWithOutgoingSocketsDenied": True,
                  "outgoingAttempts": len(attempts), "object": result["spec"]["object"]}, ensure_ascii=False))
