@echo off
cd /d "C:\Users\user\Downloads\StocksIntels/frontend"
node_modules/.bin/vite --host 0.0.0.0 --port 5174 > frontend_vite.log 2>&1
