"""Login / logout endpoints."""
import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import auth

router = APIRouter(prefix="/api", tags=["auth"])


class LoginPayload(BaseModel):
    password: str = ""


def _set_session_cookie(response: JSONResponse) -> None:
    response.set_cookie(
        key=auth.COOKIE_NAME,
        value=auth.create_session_token(),
        max_age=auth.COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        path="/",
    )


@router.post("/login")
async def login(payload: LoginPayload, request: Request):
    ip = auth.client_ip(request)

    # Already blocked?
    remaining = auth.block_remaining_seconds(ip)
    if remaining:
        raise HTTPException(status_code=429, detail=auth.block_message(remaining))

    if auth.verify_password(payload.password):
        auth.reset_attempts(ip)
        response = JSONResponse({"ok": True})
        _set_session_cookie(response)
        return response

    # Failed attempt: artificial delay, then record and possibly block.
    await asyncio.sleep(1)
    auth.record_failure(ip)

    remaining = auth.block_remaining_seconds(ip)
    if remaining:
        raise HTTPException(status_code=429, detail=auth.block_message(remaining))
    raise HTTPException(status_code=401, detail="Incorrect password.")


@router.post("/logout")
def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return response
