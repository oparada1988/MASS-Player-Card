# Music Assistant Player & Playlist Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/default)
[![GitHub release](https://img.shields.io/github/v/release/oparada1988/MASS-Player-Card?color=blue)](https://github.com/oparada1988/MASS-Player-Card/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A sleek, modern, all-in-one Lovelace card for **Home Assistant** and **Music Assistant**. Features a visual GUI configuration editor (**zero YAML required**), an interactive media player with album art and seekbar, and an auto-discovered 3-column playlist grid with 1-tap playback.

---

## ✨ Features

* **🎨 Full Visual GUI Editor**: Customize speakers, grid columns, playlist limits, and view toggles directly in the Home Assistant card editor without touching YAML.
* **⚡ Automatic Playlist Discovery**: Automatically queries Music Assistant's library to load all your playlists and high-resolution cover thumbnails.
* **🎵 1-Tap Playback**: Click any playlist tile to start streaming instantly to your speaker or group.
* **🎛️ Compact Media Player**: Includes live album artwork, track title, artist, interactive progress seekbar, and previous / play-pause / next buttons.
* **📱 Responsive 3-Column Grid**: Beautiful, low-profile internal scrollbar keeping your dashboard neat and compact even with dozens of playlists.
* **🔄 Full Backward Compatibility**: Supports `custom:mass-player-card`, `custom:mass-music-widget`, and `custom:mass-playlist-card`.

---

## 📦 Installation via HACS (Recommended)

1. Open **Home Assistant** and navigate to **HACS**.
2. Click the **three dots** in the top right corner and select **Custom repositories**.
3. In the dialog, paste the repository URL:
   ```text
   https://github.com/oparada1988/MASS-Player-Card
   ```
4. Set the **Type** to **Dashboard** (or **Lovelace**) and click **Add**.
5. Find **Music Assistant Player & Playlist Card** in HACS and click **Download**.
6. When prompted, reload your browser resources.

---

## 🛠️ Adding the Card to your Dashboard

### Option A: Using the Visual UI Editor (No YAML)
1. On your dashboard, click **Edit Dashboard** (top right) → **Add Card** (`+`).
2. Search for or select **Music Assistant Player & Playlist Card**.
3. Choose your **Media Player Entity** from the dropdown picker.
4. Customize your options (Columns, Playlist Limit, Show/Hide Player or Grid).
5. Click **Save**!

---

### Option B: Using YAML (Advanced / Manual)

```yaml
type: custom:mass-player-card
speaker_entity: media_player.home_speaker_group
grid_content: playlists  # Options: playlists or favorites
columns: 3
limit: 12
show_player: true
show_queue: true         # Auto-shows 5-track scrollable queue drawer during playback
show_playlists: true
```

#### Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `speaker_entity` | `string` | **Required** | The entity ID of the target speaker or speaker group (e.g., `media_player.home_speaker_group`). |
| `grid_content` | `string` | `playlists` | Single-choice selection: `playlists` or `favorites`. Determines what is automatically displayed on the grid. |
| `columns` | `number` | `3` | Number of columns in the media grid (1 to 6). |
| `limit` | `number` | `0` (all) | Maximum number of items to display. Set to `0` or omit to display all. |
| `show_player` | `boolean` | `true` | Toggle the media player header on or off. |
| `show_queue` | `boolean` | `true` | Automatically slides open the upcoming track queue drawer during playback (shows up to 5 tracks with scrollbar; completely hidden when idle). |
| `show_playlists` | `boolean` | `true` | Toggle the media grid section on or off. |
| `max_height` | `string` | `380px` | Maximum height of the scrollable grid (e.g. `none`, `450px`, `380px`). |
| `playlists` | `list` | `auto` | *(Optional)* Manually specify custom items if you wish to override auto-discovery. |

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
