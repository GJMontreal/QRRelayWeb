# QRRelayWeb

A mobile-first web app that scans barcodes and QR codes and forwards the decoded content as a GET request to a configurable REST endpoint.

## What it does

Point your camera at a barcode or QR code. The app decodes it, copies the value to your clipboard, and sends it to a server you've configured — with optional authentication, query parameters, GPS coordinates, and a timestamp.

Multiple server configurations are supported, each with its own endpoint, authentication scheme (Bearer token, API key, Basic Auth), and per-scan settings like auto-send, cooldown timer, and allowed barcode symbologies.

## Features

- Scans QR codes, EAN-13, EAN-8, Code 128, Code 39, Code 93, ITF, UPC-A, UPC-E, Aztec, Data Matrix, PDF417
- Uses the browser's native `BarcodeDetector` API where available, with [zxing-wasm](https://github.com/nicholasgasior/zxing-wasm) as a fallback for broader format support
- Multiple server configurations with live URL preview
- Bearer token, API key, and Basic Auth support
- Optional timestamp and GPS location parameters
- Configurable extra query parameters (fixed, text, or numeric input)
- Scan cooldown timer with animated ring
- Barcode outline drawn on detection
- Flashlight toggle

## Tech

Plain HTML, CSS, and JavaScript — no framework, no build step. Deployed as a static site via GitHub Pages.

## Notes

This project was built as an experiment in using [Claude Code](https://claude.ai/code), Anthropic's CLI coding assistant, as the primary development tool. The iOS companion app [QRRelay](https://github.com/GJMontreal/Scan2HostSwiftUI) was the reference implementation.
