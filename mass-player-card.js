/**
 * Music Assistant Player & Playlist Card for Home Assistant (HACS)
 * Repository: https://github.com/oparada1988/MASS-Player-Card
 * Version: 3.8.1
 * 
 * Features:
 * - Full Home Assistant GUI Card Editor (no YAML required)
 * - Remote Nabu Casa Support: Automatic Ingress tunneling for Music Assistant imageproxy
 * - Automatic Queue Recovery on initial load & remote reconnects
 * - On the grid show: Single-select dropdown for "Playlists" or "Favorites"
 * - Show Media Labels: Toggle to show/hide text overlays on grid cover art
 * - Automated Track Queue Drawer (with 28px album art thumbnails, smooth accordion animation)
 * - Compact Media Player (Album Art, Artist, Title, Seekbar, Controls)
 * - Auto-Discovered 3-Column Grid directly from Music Assistant
 * - 1-Tap Playback with dynamic service routing
 * - Sleek dark-mode styling matching Home Assistant Lovelace
 */

const MASS_CARD_VERSION = "3.8.1";

console.info(
  `%c MASS-PLAYER-CARD %c v${MASS_CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700; border-radius: 4px 0 0 4px; padding: 2px 6px;",
  "color: #03a9f4; background: #1c1c1e; font-weight: 700; border-radius: 0 4px 4px 0; padding: 2px 6px; border: 1px solid #03a9f4;"
);

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

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
          name: "show_volume",
          selector: {
            boolean: {}
          }
        },
        {
          name: "show_queue",
          selector: {
            boolean: {}
          }
        },
        {
          name: "show_playlists",
          selector: {
            boolean: {}
          }
        },
        {
          name: "show_labels",
          selector: {
            boolean: {}
          }
        },
        {
          name: "hide_played_queue",
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
          show_volume: "Show Volume Slider",
          show_queue: "Auto-Show Track Queue (when playing)",
          show_playlists: "Show Media Grid",
          show_labels: "Show Media Labels on Grid",
          hide_played_queue: "Clear Played Tracks from Queue"
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
      show_queue: true,
      show_playlists: true,
      show_labels: true,
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
    this._queueTracks = [];
    this._loaded = false;
    this._currentSpeaker = null;
    this._currentGridContent = null;
    this._activePlaylistId = null;
    this._fetchingQueue = false;
    this._ingressUrl = null;
    this._ingressAttempted = false;
    this._lastScrolledTrackKey = null;
    this._isDraggingVolume = false;
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
      show_queue: true,
      show_playlists: true,
      show_labels: true
    };
  }

  setConfig(config) {
    const speaker = config.speaker_entity || config.entity;
    if (!speaker) {
      throw new Error("Please specify 'speaker_entity' (e.g. media_player.home_speaker_group)");
    }
    
    const gridContent = config.grid_content || "playlists";

    if (this._currentSpeaker !== speaker || this._currentGridContent !== gridContent) {
      this._currentSpeaker = speaker;
      this._currentGridContent = gridContent;
      this._loaded = false;
      this._queueTracks = [];
    }

    this._config = {
      grid_content: "playlists",
      columns: 3,
      show_player: true,
      show_queue: true,
      show_playlists: true,
      show_labels: true,
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
    // If user is actively dragging the volume slider, don't overwrite DOM during the drag
    if (this._isDraggingVolume) {
      return;
    }

    const stateObj = hass.states[this._config.speaker_entity];

    // Auto-detect and load queue on page load or remote reconnect if playing
    const isPlaying = stateObj?.state === "playing";
    if (isPlaying && (!this._queueTracks || this._queueTracks.length === 0) && !this._fetchingQueue) {
      this._autoLoadCurrentQueue(stateObj);
    }

    this.render(stateObj);
  }

  async initIngressSession() {
    if (this._ingressUrl) return this._ingressUrl;
    if (this._ingressAttempted && this._ingressUrl) return this._ingressUrl;
    this._ingressAttempted = true;

    let slug = "d5369777_music_assistant";
    if (this._hass && this._hass.panels) {
      const p = Object.values(this._hass.panels).find(panel => 
        (panel.url_path && (panel.url_path.includes("music_assistant") || panel.url_path.includes("mass")))
      );
      if (p) {
        slug = (p.config && p.config.ingress) || p.url_path || slug;
      }
    }

    try {
      let info = null;
      try {
        info = await this._hass.callWS({
          type: "hassio/ingress/info",
          slug: slug
        });
      } catch (wsHassioErr) {
        try {
          info = await this._hass.callWS({
            type: "supervisor/ingress/info",
            slug: slug
          });
        } catch (wsSupErr) {}
      }

      if (info && info.ingress_url) {
        this._ingressUrl = info.ingress_url.endsWith('/') ? info.ingress_url : info.ingress_url + '/';
        
        try {
          await this._hass.callWS({
            type: "hassio/ingress/session",
            slug: slug
          });
        } catch (sessErr1) {
          try {
            if (typeof this._hass.callApi === "function") {
              await this._hass.callApi("POST", "hassio/ingress/session");
            }
          } catch (sessErr2) {
            try {
              await this._hass.callWS({
                type: "supervisor/ingress/session",
                slug: slug
              });
            } catch (sessErr3) {}
          }
        }

        // Re-resolve existing items with the newly found Ingress URL
        if (this._playlists && this._playlists.length > 0) {
          this._playlists = this._playlists.map(pl => ({
            ...pl,
            image: this.resolveImageUrl(pl.raw_thumbnail || pl.image)
          }));
        }
        if (this._queueTracks && this._queueTracks.length > 0) {
          this._queueTracks = this._queueTracks.map(t => ({
            ...t,
            image: this.resolveImageUrl(t.raw_thumbnail || t.image)
          }));
        }
        const stateObj = this._hass?.states[this._config.speaker_entity];
        this.render(stateObj);

        return this._ingressUrl;
      }
    } catch (e) {
      console.debug("[MASS-PLAYER-CARD] Ingress check:", e);
    }
    return null;
  }

  resolveImageUrl(url) {
    if (!url) return null;
    
    // 1. Fix the known Music Assistant size=0 bug (which triggers 400 Bad Request)
    let cleanUrl = url.replace(/([?&])size=0(&|$)/, '$1size=256$2');

    // 2. Relative HA proxy URL (like /api/media_player_proxy/...)
    if (cleanUrl.startsWith("/")) {
      return this._hass && typeof this._hass.hassUrl === "function" ? this._hass.hassUrl(cleanUrl) : cleanUrl;
    }

    // 3. Rewrite Music Assistant imageproxy URLs to the secure Ingress tunnel
    if (cleanUrl.includes("imageproxy")) {
      const idx = cleanUrl.indexOf("imageproxy");
      const pathSuffix = cleanUrl.substring(idx);
      if (this._ingressUrl) {
        const fullPath = this._ingressUrl + pathSuffix;
        return this._hass && typeof this._hass.hassUrl === "function" ? this._hass.hassUrl(fullPath) : fullPath;
      }
    }

    return cleanUrl;
  }

  async loadPlaylists() {
    await this.initIngressSession();

    let discovered = [];
    const speaker = this._config.speaker_entity;
    const targetType = this._config.grid_content || "playlists";

    const extractItems = (data) => {
      if (!data || !data.children) return [];
      return data.children.map(item => ({
        name: item.title,
        media_id: item.media_content_id || item.title,
        media_content_type: item.media_content_type || (targetType === "favorites" ? "track" : "playlist"),
        raw_thumbnail: item.thumbnail || null,
        image: this.resolveImageUrl(item.thumbnail) || null
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
          raw_thumbnail: match ? match.raw_thumbnail : null,
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

  async loadQueueForPlaylist(item) {
    if (!item || !item.media_id) return;
    await this.initIngressSession();
    this._activePlaylistId = item.media_id;
    const speaker = this._config.speaker_entity;

    try {
      const data = await this._hass.callWS({
        type: "media_player/browse_media",
        entity_id: speaker,
        media_content_id: item.media_id,
        media_content_type: item.media_content_type || "playlist"
      });

      if (data && data.children && data.children.length > 0) {
        this._queueTracks = data.children.map(t => ({
          name: t.title,
          artist: t.media_artist || "",
          duration: t.duration ? formatDuration(t.duration) : "",
          media_id: t.media_content_id || t.title,
          media_content_type: t.media_content_type || "track",
          raw_thumbnail: t.thumbnail || item.raw_thumbnail || item.image || null,
          image: this.resolveImageUrl(t.thumbnail) || this.resolveImageUrl(item.raw_thumbnail || item.image) || null
        }));
      } else {
        this._queueTracks = [{
          name: item.name,
          artist: "",
          duration: "",
          media_id: item.media_id,
          media_content_type: item.media_content_type || "playlist",
          raw_thumbnail: item.raw_thumbnail || item.image || null,
          image: this.resolveImageUrl(item.raw_thumbnail || item.image) || null
        }];
      }
    } catch (e) {
      this._queueTracks = [{
        name: item.name,
        artist: "",
        duration: "",
        media_id: item.media_id,
        media_content_type: item.media_content_type || "playlist",
        raw_thumbnail: item.raw_thumbnail || item.image || null,
        image: this.resolveImageUrl(item.raw_thumbnail || item.image) || null
      }];
    }

    const stateObj = this._hass?.states[this._config.speaker_entity];
    this.render(stateObj);
  }

  async _autoLoadCurrentQueue(stateObj) {
    if (this._fetchingQueue || !stateObj) return;
    this._fetchingQueue = true;
    await this.initIngressSession();
    const attr = stateObj.attributes || {};
    const speaker = this._config.speaker_entity;

    try {
      const album = (attr.media_album_name || "").toLowerCase().trim();
      const plAttr = (attr.media_playlist || "").toLowerCase().trim();

      let targetItem = null;
      if (this._playlists && this._playlists.length > 0) {
        targetItem = this._playlists.find(p => {
          const n = (p.name || "").toLowerCase().trim();
          return (album && album.includes(n)) || (plAttr && plAttr.includes(n));
        });
      }

      if (targetItem) {
        await this.loadQueueForPlaylist(targetItem);
      } else if (speaker) {
        const root = await this._hass.callWS({
          type: "media_player/browse_media",
          entity_id: speaker
        });
        if (root && root.children) {
          const plFolder = root.children.find(c =>
            (c.title || "").toLowerCase().includes("playlist") ||
            (c.media_content_type || "").toLowerCase().includes("playlist")
          );
          if (plFolder) {
            const plData = await this._hass.callWS({
              type: "media_player/browse_media",
              entity_id: speaker,
              media_content_id: plFolder.media_content_id,
              media_content_type: plFolder.media_content_type
            });
            if (plData && plData.children && plData.children.length > 0) {
              const match = plData.children.find(p => {
                const n = (p.title || "").toLowerCase().trim();
                return (album && album.includes(n)) || (plAttr && plAttr.includes(n));
              }) || plData.children[0];
              if (match) {
                await this.loadQueueForPlaylist({
                  name: match.title,
                  media_id: match.media_content_id,
                  media_content_type: match.media_content_type,
                  raw_thumbnail: match.thumbnail,
                  image: this.resolveImageUrl(match.thumbnail)
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("[MASS-PLAYER-CARD] Could not auto-load queue on init:", e);
    } finally {
      this._fetchingQueue = false;
    }
  }

  render(state) {
    // Preserve scroll position across 1-second state ticks
    const prevQueueList = this.shadowRoot.querySelector('.queue-list');
    const prevScrollTop = prevQueueList ? prevQueueList.scrollTop : 0;

    const attr = state?.attributes || {};
    const title = attr.media_title || (state?.state === "idle" ? "Idle" : "No Media Playing");
    const artist = attr.media_artist || (state?.state === "idle" ? "Music Assistant" : "");
    
    // Prefer locally proxied picture or resolve through hassUrl
    let rawPicture = attr.entity_picture_local || attr.entity_picture || null;
    const picture = this.resolveImageUrl(rawPicture);

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
    const showVolume = this._config.show_volume !== false;
    const showQueue = this._config.show_queue !== false;
    const showPlaylists = this._config.show_playlists !== false;
    const showLabels = this._config.show_labels !== false;
    const cols = Number(this._config.columns) || 3;
    const maxHeight = this._config.max_height || '380px';

    // Volume details
    const vol = typeof attr.volume_level === 'number' ? attr.volume_level : 0.5;
    const isMuted = attr.is_volume_muted === true;
    const volPercent = Math.round(vol * 100);

    // Playback mode (Normal, Repeat, Shuffle)
    const isShuffle = attr.shuffle === true;
    const repeatMode = attr.repeat || "off";
    let currentMode = "normal";
    if (isShuffle) {
      currentMode = "shuffle";
    } else if (repeatMode === "all" || repeatMode === "one") {
      currentMode = "repeat";
    }

    const hidePlayed = this._config.hide_played_queue !== false;
    const rawQueue = this._queueTracks || [];

    // Find currently playing track index in the queue
    let currentTrackIdx = -1;
    if (title) {
      const curTitle = title.toLowerCase().trim();
      currentTrackIdx = rawQueue.findIndex(t => {
        const tName = (t.name || "").toLowerCase().trim();
        return tName && (curTitle === tName || curTitle.includes(tName) || tName.includes(curTitle));
      });
    }

    // Filter out already-played tracks if hidePlayed is enabled
    let queueTracks = [];
    if (hidePlayed && currentTrackIdx >= 0) {
      queueTracks = rawQueue.slice(currentTrackIdx).map((t, idx) => ({
        ...t,
        original_idx: currentTrackIdx + idx + 1,
        is_playing: idx === 0 && isPlaying
      }));
    } else {
      queueTracks = rawQueue.map((t, idx) => ({
        ...t,
        original_idx: idx + 1,
        is_playing: idx === currentTrackIdx && isPlaying
      }));
    }

    const isQueueOpen = showQueue && isPlaying && queueTracks.length > 0;

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
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          color: var(--secondary-text-color, #9e9e9e);
          position: relative;
        }
        .cover-art-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 11px;
          display: block;
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
        /* Time Row (under seekbar) */
        .time-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.68rem;
          font-weight: 500;
          color: var(--secondary-text-color, #8e8e93);
          font-variant-numeric: tabular-nums;
          margin-top: 2px;
          margin-bottom: 2px;
          padding: 0 1px;
        }

        /* Controls Row */
        .controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 4px;
          padding: 0 4px;
        }
        .center-controls {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        /* Volume Row */
        .volume-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 6px;
          padding: 0 4px;
        }
        .vol-btn {
          background: none;
          border: none;
          color: var(--secondary-text-color, #a0a0a0);
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s, transform 0.1s;
        }
        .vol-btn:hover {
          color: var(--primary-color, #03a9f4);
          transform: scale(1.1);
        }
        .vol-btn svg {
          width: 18px;
          height: 18px;
          fill: currentColor;
        }
        .volume-slider-container {
          flex: 1;
          height: 6px;
          padding: 8px 0;
          background-clip: content-box;
          background-color: var(--secondary-background-color, rgba(255, 255, 255, 0.12));
          border-radius: 4px;
          cursor: pointer;
          position: relative;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }
        .volume-slider-fill {
          height: 100%;
          background-color: var(--secondary-text-color, #a0a0a0);
          border-radius: 4px;
          position: relative;
          pointer-events: none;
        }
        .volume-slider-container:hover .volume-slider-fill,
        .volume-slider-container.dragging .volume-slider-fill {
          background-color: var(--primary-color, #03a9f4);
        }
        .volume-slider-fill::after {
          content: '';
          position: absolute;
          right: -5px;
          top: 50%;
          transform: translateY(-50%);
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background-color: #ffffff;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
          opacity: 0;
          transition: opacity 0.15s ease, transform 0.1s ease;
        }
        .volume-slider-container:hover .volume-slider-fill::after,
        .volume-slider-container.dragging .volume-slider-fill::after {
          opacity: 1;
        }
        .volume-slider-container.dragging .volume-slider-fill::after {
          transform: translateY(-50%) scale(1.2);
        }
        .volume-pct {
          font-size: 0.68rem;
          color: var(--secondary-text-color, #8e8e93);
          font-variant-numeric: tabular-nums;
          min-width: 28px;
          text-align: right;
        }

        /* Playback Mode Button */
        .mode-btn {
          color: var(--secondary-text-color, #8e8e93);
          position: relative;
        }
        .mode-btn.mode-active {
          color: var(--primary-color, #03a9f4);
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

        /* 2. Track Queue Drawer (Smooth Accordion Animation) */
        .queue-drawer {
          max-height: 0;
          opacity: 0;
          overflow: hidden;
          margin-top: 0;
          margin-bottom: 0;
          transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, margin 0.35s ease;
        }
        .queue-drawer.queue-open {
          max-height: 205px;
          opacity: 1;
          margin-top: 12px;
          margin-bottom: 4px;
        }
        .queue-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 4px 6px 4px;
          font-size: 0.70rem;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: var(--secondary-text-color, #a0a0a0);
        }
        .queue-count {
          font-weight: 500;
          opacity: 0.8;
        }
        .queue-list {
          max-height: 175px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-right: 4px;
        }
        .queue-list::-webkit-scrollbar {
          width: 5px;
        }
        .queue-list::-webkit-scrollbar-track {
          background: transparent;
        }
        .queue-list::-webkit-scrollbar-thumb {
          background-color: var(--secondary-text-color, rgba(255, 255, 255, 0.2));
          border-radius: 10px;
        }
        .queue-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 8px;
          border-radius: 8px;
          cursor: pointer;
          transition: background-color 0.15s ease, color 0.15s ease;
          gap: 8px;
          min-height: 34px;
          box-sizing: border-box;
        }
        .queue-item:hover {
          background-color: var(--secondary-background-color, rgba(255, 255, 255, 0.08));
        }
        .queue-item.active-track {
          background-color: rgba(3, 169, 244, 0.14);
          border-left: 3px solid var(--primary-color, #03a9f4);
        }
        .queue-item.active-track .queue-track-name {
          color: var(--primary-color, #03a9f4);
          font-weight: 700;
        }
        .queue-item-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 1;
        }
        .queue-idx {
          font-size: 0.74rem;
          color: var(--secondary-text-color, #8e8e93);
          min-width: 16px;
          text-align: right;
          font-variant-numeric: tabular-nums;
          display: flex;
          align-items: center;
          justify-content: flex-end;
        }
        .playing-equalizer {
          display: inline-flex;
          align-items: flex-end;
          gap: 2px;
          height: 12px;
          width: 13px;
        }
        .playing-equalizer span {
          width: 2.5px;
          background-color: var(--primary-color, #03a9f4);
          border-radius: 1px;
          animation: eqBounce 1s infinite ease-in-out;
        }
        .playing-equalizer span:nth-child(1) { height: 60%; animation-delay: 0s; }
        .playing-equalizer span:nth-child(2) { height: 100%; animation-delay: 0.2s; }
        .playing-equalizer span:nth-child(3) { height: 40%; animation-delay: 0.4s; }

        @keyframes eqBounce {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
        .queue-thumb {
          width: 28px;
          height: 28px;
          min-width: 28px;
          border-radius: 6px;
          background-color: var(--secondary-background-color, rgba(255, 255, 255, 0.08));
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          color: var(--secondary-text-color, #9e9e9e);
          flex-shrink: 0;
          position: relative;
        }
        .queue-thumb-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 6px;
          display: block;
        }
        .queue-thumb svg {
          width: 14px;
          height: 14px;
          fill: currentColor;
          opacity: 0.7;
        }
        .queue-track-meta {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
        }
        .queue-track-name {
          font-size: 0.80rem;
          font-weight: 600;
          color: var(--primary-text-color, #ffffff);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .queue-track-artist {
          font-size: 0.70rem;
          color: var(--secondary-text-color, #a0a0a0);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .queue-duration {
          font-size: 0.72rem;
          color: var(--secondary-text-color, #8e8e93);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        /* Subtle Separator Line (between player/queue and media grid) */
        .divider-line {
          display: ${(showPlayer || isQueueOpen) && showPlaylists ? 'block' : 'none'};
          height: 1px;
          background: var(--ha-card-border-color, var(--divider-color, rgba(255, 255, 255, 0.08)));
          margin: 14px 2px 14px 2px;
          opacity: 0.8;
        }

        /* 3. Media Grid Section */
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
        .tile-img {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 11px;
          display: block;
          z-index: 1;
        }
        .tile-icon {
          position: absolute;
          top: 35%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 32px;
          height: 32px;
          fill: var(--primary-color, #03a9f4);
          opacity: 0.7;
          z-index: 1;
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
          z-index: 2;
        }
      </style>

      <div class="unified-card">
        <!-- TOP: Player Section -->
        <div class="player-section">
          <div class="cover-art">
            ${picture ? `<img class="cover-art-img" src="${picture}" alt="" onerror="this.style.display='none'; const s = this.nextElementSibling; if (s) s.style.display='block';" />` : ''}
            <svg viewBox="0 0 24 24" style="${picture ? 'display:none;' : ''}"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          </div>
          <div class="info-col">
            <div class="artist">${artist}</div>
            <div class="song">${title}</div>
            <div class="progress-bar-container" id="progressBar">
              <div class="progress-bar-fill"></div>
            </div>
            <div class="time-row">
              <span class="time-elapsed">${formatDuration(currentPos)}</span>
              <span class="time-total">${duration > 0 ? formatDuration(duration) : '0:00'}</span>
            </div>
            <div class="controls">
              <button class="ctrl-btn mode-btn ${currentMode !== 'normal' ? 'mode-active' : ''}" id="modeBtn" title="Mode: ${currentMode === 'normal' ? 'Normal (tap for Repeat)' : currentMode === 'repeat' ? 'Repeat (tap for Shuffle)' : 'Shuffle (tap for Normal)'}">
                ${currentMode === 'normal' 
                  ? `<svg viewBox="0 0 24 24"><path d="M14 6H2v2h12V6zm0 4H2v2h12v-2zM2 16h8v-2H2v2zm19-4.5L16.5 7v3.5H12v2h4.5V16L21 11.5z"/></svg>`
                  : currentMode === 'repeat'
                  ? `<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`
                  : `<svg viewBox="0 0 24 24"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`
                }
              </button>
              <div class="center-controls">
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
              <div style="width: 32px;"></div>
            </div>

            <!-- Volume Slider Row -->
            <div class="volume-row" style="${showVolume ? 'display: flex;' : 'display: none;'}">
              <button class="vol-btn" id="muteBtn" title="${isMuted ? 'Unmute' : 'Mute'}">
                ${isMuted || vol === 0
                  ? `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>`
                  : vol < 0.5
                  ? `<svg viewBox="0 0 24 24"><path d="M5 9v6h4l5 5V4L9 9H5zm11 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`
                  : `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L9 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`
                }
              </button>
              <div class="volume-slider-container" id="volumeBar">
                <div class="volume-slider-fill" style="width: ${isMuted ? 0 : volPercent}%;"></div>
              </div>
              <span class="volume-pct">${isMuted ? 'Muted' : `${volPercent}%`}</span>
            </div>
          </div>
        </div>

        <!-- MIDDLE: Track Queue Drawer (Smooth Accordion Effect) -->
        <div class="queue-drawer ${isQueueOpen ? 'queue-open' : 'queue-closed'}">
          <div class="queue-header">
            <span class="queue-title">UPCOMING QUEUE</span>
            <span class="queue-count">${hidePlayed && currentTrackIdx >= 0 ? `${queueTracks.length} remaining • ${rawQueue.length} total` : `${queueTracks.length} tracks`}</span>
          </div>
          <div class="queue-list">
            ${queueTracks.map((t, idx) => {
              const isCurrent = t.is_playing;
              return `
                <div class="queue-item ${isCurrent ? 'active-track' : ''}" data-track-idx="${idx}" title="Play ${t.name}">
                  <div class="queue-item-left">
                    <span class="queue-idx">${t.is_playing ? `<span class="playing-equalizer"><span></span><span></span><span></span></span>` : t.original_idx}</span>
                    <div class="queue-thumb">
                      ${t.image ? `<img class="queue-thumb-img" src="${t.image}" alt="" loading="lazy" onerror="this.style.display='none'; const s = this.nextElementSibling; if (s) s.style.display='block';" />` : ''}
                      <svg viewBox="0 0 24 24" style="${t.image ? 'display:none;' : ''}"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                    </div>
                    <div class="queue-track-meta">
                      <span class="queue-track-name">${t.name}</span>
                      ${t.artist ? `<span class="queue-track-artist">${t.artist}</span>` : ''}
                    </div>
                  </div>
                  ${t.duration ? `<span class="queue-duration">${t.duration}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- SUBTLE SEPARATOR LINE -->
        <div class="divider-line"></div>

        <!-- BOTTOM: Media Grid Section -->
        <div class="grid-container">
          ${playlists.map((pl, idx) => `
            <div class="tile" data-index="${idx}" title="${pl.name}">
              ${pl.image ? `<img class="tile-img" src="${pl.image}" alt="${pl.name}" loading="lazy" onerror="this.style.display='none'; const ic = this.parentElement.querySelector('.tile-icon'); if (ic) ic.style.display='block'; const ttl = this.parentElement.querySelector('.tile-title'); if (ttl) ttl.style.display='block';" />` : ''}
              <svg class="tile-icon" viewBox="0 0 24 24" style="${pl.image ? 'display:none;' : ''}"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
              ${showLabels ? `<div class="tile-title">${pl.name}</div>` : (pl.image ? `<div class="tile-title" style="display:none;">${pl.name}</div>` : `<div class="tile-title">${pl.name}</div>`)}
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

    // Queue item click events (tap to play track)
    this.shadowRoot.querySelectorAll('.queue-item').forEach(itemEl => {
      itemEl.onclick = () => {
        const trackIdx = parseInt(itemEl.getAttribute('data-track-idx'), 10);
        const track = queueTracks[trackIdx];
        if (track) {
          this.playTrack(track);
        }
      };
    });

    // Grid tile click events
    this.shadowRoot.querySelectorAll('.tile').forEach(tile => {
      tile.onclick = () => {
        const idx = parseInt(tile.getAttribute('data-index'), 10);
        const item = playlists[idx];
        this.playPlaylist(item);
      };
    });

    // 3-State Mode Button (Normal -> Repeat -> Shuffle -> Normal)
    const modeBtn = this.shadowRoot.getElementById('modeBtn');
    if (modeBtn) {
      modeBtn.onclick = () => {
        const speaker = this._config.speaker_entity;
        if (currentMode === 'normal') {
          this._hass.callService("media_player", "repeat_set", { entity_id: speaker, repeat: "all" });
          this._hass.callService("media_player", "shuffle_set", { entity_id: speaker, shuffle: false });
        } else if (currentMode === 'repeat') {
          this._hass.callService("media_player", "repeat_set", { entity_id: speaker, repeat: "off" });
          this._hass.callService("media_player", "shuffle_set", { entity_id: speaker, shuffle: true });
        } else {
          this._hass.callService("media_player", "repeat_set", { entity_id: speaker, repeat: "off" });
          this._hass.callService("media_player", "shuffle_set", { entity_id: speaker, shuffle: false });
        }
      };
    }

    // Mute toggle
    const muteBtn = this.shadowRoot.getElementById('muteBtn');
    if (muteBtn) {
      muteBtn.onclick = () => {
        this._hass.callService("media_player", "volume_mute", {
          entity_id: this._config.speaker_entity,
          is_volume_muted: !isMuted
        });
      };
    }

    // Smooth 1:1 Interactive Volume Slider
    const volumeBar = this.shadowRoot.getElementById('volumeBar');
    const volumeFill = this.shadowRoot.querySelector('.volume-slider-fill');
    const volumePct = this.shadowRoot.querySelector('.volume-pct');

    if (volumeBar && volumeFill && volumePct) {
      let isDragging = false;
      let lastCallTime = 0;

      const updateVolume = (e, isFinal = false) => {
        const rect = volumeBar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const pct = Math.round(ratio * 100);

        // Immediate 1:1 visual update (0ms lag, butter-smooth)
        volumeFill.style.width = `${pct}%`;
        volumePct.textContent = `${pct}%`;

        // Throttled service calls (~75ms) during drag, immediate on release
        const now = Date.now();
        if (isFinal || now - lastCallTime > 75) {
          lastCallTime = now;
          this._hass.callService("media_player", "volume_set", {
            entity_id: this._config.speaker_entity,
            volume_level: ratio
          });
        }
      };

      volumeBar.onpointerdown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        this._isDraggingVolume = true;
        volumeBar.setPointerCapture(e.pointerId);
        volumeBar.classList.add('dragging');
        updateVolume(e);
      };

      volumeBar.onpointermove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        updateVolume(e);
      };

      const handlePointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;
        try {
          volumeBar.releasePointerCapture(e.pointerId);
        } catch (_) {}
        volumeBar.classList.remove('dragging');
        updateVolume(e, true);
        setTimeout(() => {
          this._isDraggingVolume = false;
        }, 400);
      };

      volumeBar.onpointerup = handlePointerUp;
      volumeBar.onpointercancel = handlePointerUp;
    }

    // Gated Auto-Scroll: only reset to top when track actually advances; otherwise preserve user scroll position!
    const trackKey = `${title}-${currentTrackIdx}`;
    const isTrackChanged = this._lastScrolledTrackKey !== trackKey;

    requestAnimationFrame(() => {
      const queueList = this.shadowRoot.querySelector('.queue-list');
      if (queueList) {
        if (isTrackChanged) {
          this._lastScrolledTrackKey = trackKey;
          queueList.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          queueList.scrollTop = prevScrollTop;
        }
      }
    });
  }

  playPlaylist(item) {
    const speaker = this._config.speaker_entity;
    const targetType = this._config.grid_content || "playlists";
    const mediaType = item.media_content_type || (targetType === "favorites" ? "track" : "playlist");

    console.log(`[MASS-PLAYER-CARD v${MASS_CARD_VERSION}] Playing ${mediaType} on ${speaker}:`, item);

    // Auto-fetch upcoming queue for this playlist
    this.loadQueueForPlaylist(item);

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

  playTrack(track) {
    const speaker = this._config.speaker_entity;
    console.log(`[MASS-PLAYER-CARD v${MASS_CARD_VERSION}] Playing queue track on ${speaker}:`, track);

    const hasMusicAssistantAction = this._hass.services &&
      this._hass.services.music_assistant &&
      this._hass.services.music_assistant.play_media;

    if (hasMusicAssistantAction) {
      this._hass.callService("music_assistant", "play_media", {
        media_type: track.media_content_type || "track",
        media_id: track.media_id || track.name,
      }, { entity_id: speaker });
    } else {
      this._hass.callService("media_player", "play_media", {
        media_content_type: track.media_content_type || "music",
        media_content_id: track.media_id || track.name,
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
safeDefine("mass-music-widget", class extends MassPlayerCard {});
safeDefine("mass-playlist-card", class extends MassPlayerCard {});
safeDefine("mass-playlist-widget", class extends MassPlayerCard {});
safeDefine("mass-player-widget", class extends MassPlayerCard {});

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
