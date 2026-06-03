"""
Legacy fallback - uses MetaTrader5 library.
If you see this error, the Playwright-based scraper (mt5Service.js) failed.
Install Playwright for Python: pip install playwright && playwright install chromium
"""
import MetaTrader5 as mt5
import json
import sys
import threading
import os

RESULT = None
TIMEOUT = 25

def find_terminal_paths():
    paths = []
    prog_dirs = [
        os.environ.get('ProgramFiles', 'C:\\Program Files'),
        os.environ.get('ProgramFiles(x86)', 'C:\\Program Files (x86)'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs'),
    ]
    seen = set()
    for base in prog_dirs:
        if not base or not os.path.isdir(base):
            continue
        try:
            for entry in os.listdir(base):
                full = os.path.join(base, entry)
                if not os.path.isdir(full):
                    continue
                low = entry.lower()
                if any(kw in low for kw in ['metatrader', 'meta.trader', 'mt5', 'mt4', 'terminal']):
                    exe = os.path.join(full, 'terminal64.exe')
                    if os.path.isfile(exe) and exe not in seen:
                        paths.append(exe)
                        seen.add(exe)
        except PermissionError:
            continue
    return paths

def try_initialize(path=None):
    try:
        if path:
            return mt5.initialize(path=path, timeout=10000)
        else:
            return mt5.initialize(timeout=10000)
    except Exception:
        return False

def run_mt5(login, password, server):
    global RESULT
    terminal_paths = find_terminal_paths()
    terminal_paths.append(None)
    init_ok = False
    for tp in terminal_paths:
        try: mt5.shutdown()
        except: pass
        init_ok = try_initialize(tp)
        if init_ok:
            break
    if not init_ok:
        RESULT = {"error": "MT5 terminal not found. Install MetaTrader 5 or use the WebTrader sync method.", "detail": f"Searched: {[p for p in terminal_paths if p]}"}
        return
    authorized = mt5.login(login=login, password=password, server=server)
    if not authorized:
        err = mt5.last_error()
        RESULT = {"error": "Login failed. Check your account ID, password, and server name.", "detail": str(err)}
        try: mt5.shutdown()
        except: pass
        return
    account_info = mt5.account_info()
    account_dict = None
    if account_info:
        account_dict = {
            "login": account_info.login, "balance": account_info.balance, "equity": account_info.equity,
            "margin": account_info.margin, "margin_free": account_info.margin_free,
            "currency": account_info.currency, "leverage": account_info.leverage,
            "name": account_info.name, "server": account_info.server,
        }
    positions = mt5.positions_get()
    positions_list = []
    if positions:
        for pos in positions:
            positions_list.append({
                "symbol": pos.symbol, "type": "buy" if pos.type == 0 else "sell",
                "volume": pos.volume, "price_open": pos.price_open,
                "price_current": pos.price_current, "profit": pos.profit,
                "swap": pos.swap, "commission": pos.commission,
                "sl": pos.sl, "tp": pos.tp, "time": str(pos.time), "comment": pos.comment,
            })
    try: mt5.shutdown()
    except: pass
    RESULT = {"account": account_dict, "positions": positions_list}

def main():
    global RESULT
    login = int(sys.argv[1])
    password = sys.argv[2]
    server = sys.argv[3]
    thread = threading.Thread(target=run_mt5, args=(login, password, server), daemon=True)
    thread.start()
    thread.join(timeout=TIMEOUT)
    if thread.is_alive():
        print(json.dumps({"error": "MT5 connection timed out."}))
        return
    if RESULT is None:
        print(json.dumps({"error": "Unknown MT5 error occurred."}))
        return
    print(json.dumps(RESULT))

if __name__ == "__main__":
    main()
