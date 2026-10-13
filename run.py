"""
Supermarket Smart Billing & Inventory Management System
Main Entrypoint Script
"""
import sys
import os
import webbrowser
import threading
import time
import uvicorn

def open_browser():
    time.sleep(1.2)
    url = "http://127.0.0.1:8000"
    print(f"\n[POS SYSTEM] Opening POS Terminal in default browser: {url}\n")
    webbrowser.open(url)

if __name__ == "__main__":
    print("=" * 60)
    print("  METRO FRESH - SMART SUPERMARKET BILLING & POS ENGINE  ")
    print("=" * 60)
    print("Initializing Database, Seed Data & Web Server...")

    # Start browser in background thread
    threading.Thread(target=open_browser, daemon=True).start()

    # Launch FastAPI application via Uvicorn
    port = int(os.environ.get("PORT", 8000)); uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=False)


