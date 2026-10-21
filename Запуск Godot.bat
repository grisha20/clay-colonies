@echo off
cd /d "%~dp0"
py -B scripts\godot\play.py
if errorlevel 1 pause
