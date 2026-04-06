# HubSpot Data Manager

A tool for The Maimon Group's marketing team to process OwnerPoint CSV exports for HubSpot import.

## Features

- **CSV Upload & Parse** – Drag-and-drop CSV file processing
- **Name Parsing** – Handles middle names/initials, prefixes (Dr., Mr.), suffixes (Jr., III), and "Last, First" format
- **Property Field Mapping** – Map CSV columns to HubSpot fields with 4 address types (Primary, Listing, STR/LTR, Agent)
- **Deduplication** – Remove duplicate contacts by email, name, or custom keys
- **Labels & Tags** – Apply sources, contact types, property types, departments, and statuses
- **List Naming Convention** – Validate DEPT-TYPE-Source-Date-Description format
- **AB Split** – Configurable holdout % (default 20%), split remaining 50/50
- **HubSpot Import** – Batch import contacts via HubSpot API
- **CSV Export** – Download processed data as HubSpot-ready CSV

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and add your HubSpot access token:
   ```bash
   cp .env.example .env
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open http://localhost:3001 in your browser

## Standalone Mode

The web UI (`public/index.html`) works entirely in-browser for basic CSV processing — no server needed. Just open the HTML file directly. The server is only required for HubSpot API integration.

## Naming Convention

Lists should follow the format: `DEPT-TYPE-Source-YYYYMMDD-Description`

Example: `MKT-OWNER-OwnerPoint-20260404-Orlando_SFR_Absentee`

## For Rebecca

This tool is designed to process OwnerPoint CSV exports. The typical workflow is:

1. Upload your OwnerPoint CSV export
2. Fix any name parsing issues (Last, First format)
3. Map OwnerPoint fields to HubSpot contact properties
4. Remove duplicate contacts
5. Apply labels (source, type, department, status)
6. Name your list using the convention
7. Set up AB split if needed
8. Export the final CSV or push directly to HubSpot
