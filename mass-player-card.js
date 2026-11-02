/**
 * Music Assistant Player & Playlist Card for Home Assistant (HACS)
 * Repository: https://github.com/oparada1988/MASS-Player-Card
 * Version: 3.1.0
 * 
 * Features:
 * - Full Home Assistant GUI Card Editor (no YAML required)
 * - On the grid show: Single-select dropdown for "Playlists" or "Favorites"
 * - Compact Media Player (Album Art, Artist, Title, Seekbar, Controls)
 * - Auto-Discovered 3-Column Grid directly from Music Assistant
 * - 1-Tap Playback with dynamic service routing
 * - Sleek dark-mode styling matching Home Assistant Lovelace
 */

const MASS_CARD_VERSION = "3.1.0";

console.info(
  `%c MASS-PLAYER-CARD %c v${MASS_CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700; border-radius: 4px 0 0 4px; padding: 2px 6px;",
  "color: #03a9f4; background: #1c1c1e; font-weight: 700; border-radius: 0 4px 4px 0; padding: 2px 6px; border: 1px solid #03a9f4;"
);

/* ==========================================================================
   1. VISUAL CARD CONFIGURATION EDITOR (GUI)
   ========================================================================== */
class MassPlayerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;

    let form = this.shadowRoot.querySelector("ha-form");
    if (!form) {
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
          }
          ha-form {
            display: block;
            padding: 8px 0;
          }
        </style>
      `;

      form = document.createElement("ha-form");
      form.schema = [
        {
          name: "speaker_entity",
          required: true,
          selector: {
            entity: {
              domain: "media_player"
            }
          }
        },
        {
          name: "grid_content",
          selector: {
            select: {
              options: [
                { value: "playlists", label: "Playlists" },
                { value: "favorites", label: "Favorites" }
              ],
              mode: "dropdown"
            }
          }
        },
        {
          name: "columns",
          selector: {
            number: {
              min: 1,
              max: 6,
              step: 1,
              mode: "box"
            }
          }
        },
        {
          name: "limit",
          selector: {
            number: {
              min: 0,
              max: 100,
              step: 1,
              mode: "box"
            }
          }
        },
        {
          name: "show_player",
          selector: {
            boolean: {}
          }
        },
        {
          name: "show_playlists",
          selector: {
            boolean: {}
          }
        }
      ];

      form.computeLabel = (schema) => {
        const labels = {
          speaker_entity: "Media Player Entity",
          grid_content: "On the grid show",
          columns: "Grid Columns (default: 3)",
          limit: "Item Limit (0 = show all)",
          show_player: "Show Media Player Widget",
          show_playlists: "Show Media Grid"
        };
        return labels[schema.name] || schema.name;
      };

      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._config = {
          ...this._config,
          ...ev.detail.value
        };
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true
          })
        );
      });

      this.shadowRoot.appendChild(form);
    }

    form.hass = this._hass;
    form.data = {
      grid_content: "playlists",
      columns: 3,
      show_player: true,
      show_playlists: true,
      limit: 0,
      ...this._config
    };
  }
}

/* ==========================================================================
   2. MAIN LOVELACE CARD
   ========================================================================== */
class MassPlayerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._playlists = [];
    this._loaded = false;
    this._currentSpeaker = null;
    this._currentGridContent = null;
  }

  static async getConfigElement() {
    return document.createElement("mass-player-card-editor");
  }

  static getStubConfig(hass, entities, entitiesFallback) {
    const mediaPlayers = Object.keys(hass.states).filter(eid => eid.startsWith("media_player."));
    const preferred = mediaPlayers.find(eid => eid.includes("speaker_group") || eid.includes("mass")) || mediaPlayers[0] || "";
    return {
      speaker_entity: preferred,
      grid_content: "playlists",
      columns: 3,
      show_player: true,
      show_playlists: true
    };
  }

  setConfig(config) {
    const speaker = config.speaker_entity || config.entity;
    if (!speaker) {
      throw new Error("Please specify 'speaker_entity' (e.g. media_player.home_speaker_group)");
    }
    
    const gridContent = config.grid_content || "playlists";

    // Reload if speaker entity or grid content mode changes
    if (this._currentSpeaker !== speaker || this._currentGridContent !== gridContent) {
      this._currentSpeaker = speaker;
      this._currentGridContent = gridContent;
      this._loaded = false;
    }

    this._config = {
      grid_content: "playlists",
      columns: 3,
      show_player: true,
      show_playlists: true,
      limit: 0,
      ...config,
      speaker_entity: speaker,
      entity: speaker
    };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded) {
      this._loaded = true;
      this.loadPlaylists();
    }
    const stateObj = hass.states[this._config.speaker_entity];
    this.render(stateObj);
  }

  async loadPlaylists() {
    let discovered = [];
    const speaker = this._config.speaker_entity;
    const targetType = this._config.grid_content || "playlists";

    const extractItems = (data) => {
      if (!data || !data.children) return [];
      return data.children.map(item => ({
        name: item.title,
        media_id: item.media_content_id || item.title,
        media_content_type: item.media_content_type || (targetType === "favorites" ? "track" : "playlist"),
        image: item.thumbnail || null
      }));
    };

    if (speaker) {
      try {
        const root = await this._hass.callWS({
          type: "media_player/browse_media",
          entity_id: speaker
        });

        if (root && root.children) {
          let folder = null;

          if (targetType === "favorites") {
            // Find Favorites or Tracks (Liked Songs in Music Assistant)
            folder = root.children.find(c => {
              const t = (c.title || "").toLowerCase();
              const id = (c.media_content_id || "").toLowerCase();
              return t.includes("favorite") || id.includes("favorite") || t.includes("liked") || id.includes("liked");
            }) || root.children.find(c => {
              const t = (c.title || "").toLowerCase();
              const id = (c.media_content_id || "").toLowerCase();
              return t.includes("track") || id.includes("track");
            });
          } else {
            // Find Playlists folder
            folder = root.children.find(c => {
              const t = (c.title || "").toLowerCase();
              const id = (c.media_content_id || "").toLowerCase();
              const mc = (c.media_class || "").toLowerCase();
              return t.includes("playlist") || id.includes("playlist") || mc.includes("playlist");
            });
          }

          if (folder) {
            const mediaData = await this._hass.callWS({
              type: "media_player/browse_media",
              entity_id: speaker,
              media_content_id: folder.media_content_id,
              media_content_type: folder.media_content_type
            });
            discovered = extractItems(mediaData);
          }
        }
      } catch (err) {
        console.warn("[MASS-PLAYER-CARD] Could not query browse_media:", err);
      }
    }

    if (this._config.playlists && Array.isArray(this._config.playlists) && this._config.playlists.length > 0) {
      this._playlists = this._config.playlists.map(pl => {
        if (pl.image) return pl;
        const match = discovered.find(d => 
          (d.name || "").toLowerCase().trim() === (pl.name || "").toLowerCase().trim()
        );
        return {
          ...pl,
          image: match ? match.image : null,
          media_id: pl.media_id || (match ? match.media_id : pl.name)
        };
      });
    } else if (discovered.length > 0) {
      this._playlists = discovered;
    } else {
      this._playlists = targetType === "favorites" ? [
        { name: "Favorite Tracks", media_id: "tracks" }
      ] : [
        { name: "All Out 80s", media_id: "All Out 80s" },
        { name: "Marvel83' Mix", media_id: "Marvel83' Mix" },
        { name: "Night Tapes Radio", media_id: "Night Tapes Radio" },
        { name: "SynthwaveVaporwave", media_id: "SynthwaveVaporwave" },
        { name: "This Is Brothertiger", media_id: "This Is Brothertiger" },
        { name: "vaporwave", media_id: "vaporwave" },
      ];
    }

    if (this._config.limit && Number(this._config.limit) > 0) {
      this._playlists = this._playlists.slice(0, Number(this._config.limit));
    }

    const stateObj = this._hass?.states[this._config.speaker_entity];
    this.render(stateObj);
  }

  render(state) {
    const attr = state?.attributes || {};
    const title = attr.media_title || (state?.state === "idle" ? "Idle" : "No Media Playing");
    const artist = attr.media_artist || (state?.state === "idle" ? "Music Assistant" : "");
    const picture = attr.entity_picture ? attr.entity_picture : null;
    const isPlaying = state?.state === "playing";

    const duration = attr.media_duration || 0;
    const pos = attr.media_position || 0;
    const updatedAt = attr.media_position_updated_at ? new Date(attr.media_position_updated_at).getTime() : Date.now();
    let currentPos = pos;
    if (isPlaying && duration > 0) {
      currentPos += (Date.now() - updatedAt) / 1000;
    }
    const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentPos / duration) * 100)) : 0;
    const playlists = this._playlists;

    const showPlayer = this._config.show_player !== false;
    const showPlaylists = this._config.show_playlists !== false;
    const cols = Number(this._config.columns) || 3;
    const maxHeight = this._config.max_height || '380px';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--ha-card-header-font-family, system-ui, -apple-system, sans-serif);
        }
        .unified-card {
          background-color: var(--ha-card-background, var(--card-background-color, #1c1c1e));
          border-radius: var(--ha-card-border-radius, 16px);
          border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, rgba(255, 255, 255, 0.08)));
          box-shadow: var(--ha-card-box-shadow, none);
          padding: 16px;
          box-sizing: border-box;
          color: var(--primary-text-color, #ffffff);
          transition: background-color 0.3s ease;
        }

        /* 1. Player Section */
        .player-section {
          display: ${showPlayer ? 'flex' : 'none'};
          align-items: center;
          gap: 16px;
          padding: 2px 4px;
        }
        .cover-art {
          width: 76px;
          height: 76px;
          min-width: 76px;
          border-radius: 12px;
          background-color: var(--secondary-background-color, rgba(255, 255, 255, 0.06));
          border: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(255, 255, 255, 0.08)));
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          color: var(--secondary-text-color, #9e9e9e);
        }
        .cover-art svg {
          width: 36px;
          height: 36px;
          fill: currentColor;
          opacity: 0.7;
        }
        .info-col {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
          gap: 4px;
        }
        .artist {
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--primary-text-color, #ffffff);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .song {
          font-size: 0.92rem;
          font-weight: 500;
          color: var(--secondary-text-color, #a0a0a0);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .progress-bar-container {
          width: 100%;
          height: 6px;
          background-color: var(--secondary-background-color, rgba(255, 255, 255, 0.12));
          border-radius: 3px;
          margin-top: 6px;
          margin-bottom: 6px;
          cursor: pointer;
          position: relative;
        }
        .progress-bar-fill {
          height: 100%;
          background-color: var(--primary-color, #03a9f4);
          border-radius: 3px;
          width: ${progressPercent}%;
          transition: width 0.3s linear;
        }
        .controls {
          display: flex;
          align-items: center;
          justify-content: space-around;
          margin-top: 2px;
        }
        .ctrl-btn {
          background: none;
          border: none;
          color: var(--primary-text-color, #ffffff);
          cursor: pointer;
          padding: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: transform 0.1s ease, color 0.2s, background-color 0.2s;
        }
        .ctrl-btn:hover {
          color: var(--primary-color, #03a9f4);
          background-color: rgba(255, 255, 255, 0.08);
          transform: scale(1.1);
        }
        .ctrl-btn:active {
          transform: scale(0.95);
        }
        .ctrl-btn svg {
          width: 24px;
          height: 24px;
          fill: currentColor;
        }

        /* Subtle Separator Line */
        .divider-line {
          display: ${showPlayer && showPlaylists ? 'block' : 'none'};
          height: 1px;
          background: var(--ha-card-border-color, var(--divider-color, rgba(255, 255, 255, 0.08)));
          margin: 14px 2px 14px 2px;
          opacity: 0.8;
        }

        /* 2. Media Grid Section */
        .grid-container {
          display: ${showPlaylists ? 'grid' : 'none'};
          grid-template-columns: repeat(${cols}, 1fr);
          gap: 12px;
          max-height: ${maxHeight};
          overflow-y: auto;
          padding-right: 4px;
        }
        .grid-container::-webkit-scrollbar {
          width: 5px;
        }
        .grid-container::-webkit-scrollbar-track {
          background: transparent;
        }
        .grid-container::-webkit-scrollbar-thumb {
          background-color: var(--secondary-text-color, rgba(255, 255, 255, 0.2));
          border-radius: 10px;
        }
        .tile {
          aspect-ratio: 1 / 1;
          background-color: var(--secondary-background-color, rgba(255, 255, 255, 0.06));
          border: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(255, 255, 255, 0.08)));
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          padding: 8px;
          box-sizing: border-box;
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: transform 0.15s ease, filter 0.15s ease, border-color 0.15s ease;
        }
        .tile:hover {
          filter: brightness(1.15);
          transform: translateY(-2px);
          border-color: var(--primary-color, #03a9f4);
        }
        .tile:active {
          transform: scale(0.96);
        }
        .tile-icon {
          position: absolute;
          top: 30%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 32px;
          height: 32px;
          fill: var(--primary-color, #03a9f4);
          opacity: 0.6;
        }
        .tile-title {
          font-size: 0.76rem;
          font-weight: 600;
          color: #ffffff;
          text-align: center;
          background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 100%);
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 14px 6px 6px 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>

      <div class="unified-card">
        <!-- TOP: Player Section -->
        <div class="player-section">
          <div class="cover-art" style="${picture ? `background-image: url('${picture}')` : ''}">
            ${!picture ? `<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>` : ''}
          </div>
          <div class="info-col">
            <div class="artist">${artist}</div>
            <div class="song">${title}</div>
            <div class="progress-bar-container" id="progressBar">
              <div class="progress-bar-fill"></div>
            </div>
            <div class="controls">
              <button class="ctrl-btn" id="prevBtn" title="Previous">
                <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
              </button>
              <button class="ctrl-btn" id="playPauseBtn" title="${isPlaying ? 'Pause' : 'Play'}">
                ${isPlaying 
                  ? `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>` 
                  : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`}
              </button>
              <button class="ctrl-btn" id="nextBtn" title="Next">
                <svg viewBox="0 0 24 24"><path d="m6 18 8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- SUBTLE SEPARATOR LINE -->
        <div class="divider-line"></div>

        <!-- BOTTOM: Media Grid Section -->
        <div class="grid-container">
          ${playlists.map((pl, idx) => `
            <div class="tile" data-index="${idx}" style="${pl.image ? `background-image: url('${pl.image}')` : ''}" title="${pl.name}">
              ${!pl.image ? `<svg class="tile-icon" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>` : ''}
              <div class="tile-title">${pl.name}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Player button events
    const prevBtn = this.shadowRoot.getElementById('prevBtn');
    if (prevBtn) {
      prevBtn.onclick = () => {
        this._hass.callService("media_player", "media_previous_track", { entity_id: this._config.speaker_entity });
      };
    }
    const playPauseBtn = this.shadowRoot.getElementById('playPauseBtn');
    if (playPauseBtn) {
      playPauseBtn.onclick = () => {
        this._hass.callService("media_player", "media_play_pause", { entity_id: this._config.speaker_entity });
      };
    }
    const nextBtn = this.shadowRoot.getElementById('nextBtn');
    if (nextBtn) {
      nextBtn.onclick = () => {
        this._hass.callService("media_player", "media_next_track", { entity_id: this._config.speaker_entity });
      };
    }

    if (duration > 0) {
      const progressBar = this.shadowRoot.getElementById('progressBar');
      if (progressBar) {
        progressBar.onclick = (e) => {
          const rect = progressBar.getBoundingClientRect();
          const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const seekPosition = clickRatio * duration;
          this._hass.callService("media_player", "media_seek", {
            entity_id: this._config.speaker_entity,
            seek_position: seekPosition
          });
        };
      }
    }

    // Grid tile click events
    this.shadowRoot.querySelectorAll('.tile').forEach(tile => {
      tile.onclick = () => {
        const idx = parseInt(tile.getAttribute('data-index'), 10);
        const item = playlists[idx];
        this.playPlaylist(item);
      };
    });
  }

  playPlaylist(item) {
    const speaker = this._config.speaker_entity;
    const targetType = this._config.grid_content || "playlists";
    const mediaType = item.media_content_type || (targetType === "favorites" ? "track" : "playlist");

    console.log(`[MASS-PLAYER-CARD v${MASS_CARD_VERSION}] Playing ${mediaType} on ${speaker}:`, item);

    const hasMusicAssistantAction = this._hass.services &&
      this._hass.services.music_assistant &&
      this._hass.services.music_assistant.play_media;

    if (hasMusicAssistantAction) {
      this._hass.callService("music_assistant", "play_media", {
        media_type: mediaType,
        media_id: item.media_id || item.name,
      }, { entity_id: speaker });
    } else {
      this._hass.callService("media_player", "play_media", {
        media_content_type: mediaType,
        media_content_id: item.media_id || item.name,
      }, { entity_id: speaker });
    }
  }

  getCardSize() {
    return 6;
  }
}

/* ==========================================================================
   3. REGISTRATION & HACS LOVELACE PICKER INTEGRATION
   ========================================================================== */
function safeDefine(tagName, elementClass) {
  if (!customElements.get(tagName)) {
    try {
      customElements.define(tagName, elementClass);
      console.log(`[MASS-PLAYER-CARD v${MASS_CARD_VERSION}] Registered <${tagName}>`);
    } catch (e) {
      console.warn(`[MASS-PLAYER-CARD v${MASS_CARD_VERSION}] Could not register <${tagName}>:`, e);
    }
  }
}

// Register Visual GUI Editor
safeDefine("mass-player-card-editor", MassPlayerCardEditor);

// Register Primary Card & Backward-Compatible Aliases
safeDefine("mass-player-card", MassPlayerCard);
safeDefine("mass-music-widget", MassPlayerCard);
safeDefine("mass-playlist-card", MassPlayerCard);
safeDefine("mass-playlist-widget", MassPlayerCard);
safeDefine("mass-player-widget", MassPlayerCard);

// Register to Home Assistant's Visual Card Picker ("+ Add Card" modal)
window.customCards = window.customCards || [];
const alreadyRegistered = window.customCards.some(c => c.type === "mass-player-card");
if (!alreadyRegistered) {
  window.customCards.push({
    type: "mass-player-card",
    name: "Music Assistant Player & Playlist Card",
    description: "All-in-one compact player with visual seekbar and auto-discovered playlist/favorites grid for Music Assistant.",
    preview: true,
    documentationURL: "https://github.com/oparada1988/MASS-Player-Card"
  });
}
