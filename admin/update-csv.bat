@echo off
echo ===========================================
echo  POP SORTE ADMIN - CSV UPDATE SCRIPT
echo ===========================================
echo.
echo This script helps you update the CSV data files.
echo.
echo INSTRUCTIONS:
echo 1. Export your Google Sheets as CSV files
echo 2. Run this script
echo 3. Copy the new CSV files when prompted
echo 4. Refresh your admin dashboard
echo.
echo Press any key to continue...
pause >nul

echo.
echo Opening data folder...
start "" "%~dp0data"

echo.
echo ===========================================
echo  CSV FILES TO UPDATE:
echo ===========================================
echo.
echo 1. entries.csv - From your ENTRIES sheet
echo 2. results.csv - From your RESULTS sheet
echo 3. recharge-popluz.csv - From POPLUZ recharge sheet
echo 4. recharge-popn1.csv - From POPN1 recharge sheet
echo.
echo Replace these files with your exported CSVs.
echo.
echo Press any key when done...
pause >nul

echo.
echo CSV files updated! Refresh your admin dashboard.
echo.
pause