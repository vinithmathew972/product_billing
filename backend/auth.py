import hashlib
import os
import secrets
import datetime
from typing import Optional, Dict
from fastapi import HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer(auto_error=False)

# In-memory active session token store (token -> {user_id, username, role, expires_at})
ACTIVE_SESSIONS: Dict[str, dict] = {}

def hash_password(password: str, salt: Optional[str] = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    # PBKDF2-HMAC-SHA256 with 100,000 iterations
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return f"{salt}${key.hex()}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        salt, key_hex = hashed_password.split('$', 1)
        test_key = hashlib.pbkdf2_hmac('sha256', plain_password.encode('utf-8'), salt.encode('utf-8'), 100000)
        return secrets.compare_digest(key_hex, test_key.hex())
    except Exception:
        return False

def create_session_token(user_id: int, employee_id: str, username: str, name: str, role: str) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=7)
    ACTIVE_SESSIONS[token] = {
        "user_id": user_id,
        "employee_id": employee_id,
        "username": username,
        "name": name,
        "role": role,
        "expires_at": expires_at
    }
    return token

def revoke_session_token(token: str):
    if token in ACTIVE_SESSIONS:
        del ACTIVE_SESSIONS[token]

def get_current_user_session(credentials: Optional[HTTPAuthorizationCredentials] = Security(security)) -> dict:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Authentication required. Please login.")
    
    token = credentials.credentials
    session = ACTIVE_SESSIONS.get(token)
    
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid. Please login again.")
    
    if session["expires_at"] < datetime.datetime.utcnow():
        del ACTIVE_SESSIONS[token]
        raise HTTPException(status_code=401, detail="Session has expired. Please login again.")
    
    return session

def require_owner_role(session: dict = Depends(get_current_user_session)) -> dict:
    if session.get("role") != "OWNER":
        raise HTTPException(status_code=403, detail="Access denied. Owner privileges required.")
    return session

def require_authenticated_user(session: dict = Depends(get_current_user_session)) -> dict:
    return session
