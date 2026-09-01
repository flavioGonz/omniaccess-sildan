# Architecture Update: Enhanced Map & Reporting System

## Overview
This update introduces advanced mapping capabilities to the Admin Console, including multi-suspect tracking, direct reporting from the map, and a refined glassmorphism UI. Additionally, it fixes the panic button interaction on the Guard Console.

## Changes

### 1. Admin Console (`/admin/consolas`)
- **Glassmorphism UI**: The "Mapa Táctico" title now features a modern, translucent glassmorphism effect (`backdrop-blur-xl`, `bg-white/30`).
- **Feature: Reporting from Map**:
  - Implemented `onLongPress` handler on the map to trigger a "Report Incident" modal.
  - Admins can now report "Subject" or "Vehicle" directly from the map.
- **Feature: Multi-Suspect Tracking**:
  - The map now renders multiple active backup missions simultaneously.
  - Real-time socket events (`backup_requested`, `backup_resolved`) maintain the list of active incidents.

### 2. LiveGuardMap Component
- **Zoom Controls**: Moved to `bottom-left` corner for better ergonomics.
- **Multi-Mission Support**: Updated to accept an array of `backupMissions` locally or from props, allowing multiple markers and routes to be displayed at once.
- **Auto-Fit**: Added logic to automatically fit map bounds to all guards if the admin's own location is not available.

### 3. Guard Console (`/guard`)
- **Panic Button Fix**: 
  - Added `touch-action: none` to prevent browser scrolling/context menus during long-press.
  - Refined `onTouchStart` and `onMouseDown` handlers to ensure reliable activation.

## Technical Details

### Socket Events
- **`backup_requested`**: Payload now includes unique IDs to allow tracking multiple distinct missions.
- **`backup_resolved` / `backup_cancelled`**: Events now filter the local state array `activeMissions` to remove the specific resolved mission by ID.

### UI/UX
- **Glassmorphism**: Utilized Tailwind classes `bg-white/30`, `backdrop-blur-xl`, `border-white/20` for the premium feel.
- **Map Interaction**: Long-press (800ms) on map triggers the reporting flow.

## Verification
- **Admin Map**: Verify that long-pressing anywhere on the map opens the "Reportar Incidente" modal.
- **Multiple Alerts**: Create multiple reports (from Admin or Guards) and verify they all appear on the Admin Map.
- **Panic Button**: On a touch device (or simulator), verify that holding the panic button triggers the alert after 1.5s without scrolling the page.
