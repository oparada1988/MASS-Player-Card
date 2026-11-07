/**
 * Music Assistant Player & Playlist Card for Home Assistant (HACS)
 * Repository: https://github.com/oparada1988/MASS-Player-Card
 * Version: 3.9.1
 * 
 * Features:
 * - Full Home Assistant GUI Card Editor (no YAML required)
 * - Auto-Inferred Domain & Ingress Tunneling for Music Assistant imageproxy (hass.domain -> mass.domain)
 * - Optional Music Assistant Server URL override for Nabu Casa / custom reverse proxies
 * - Live Preview synchronization for all Card Editor toggles and settings
 * - Multi-Playlist Party Queueing: Select multiple playlists in sequence with numbered badges and combined multi-playlist playback
 * - Global Multi-Playlist Shuffle: Shuffle intermingles tracks across all selected queued playlists
 * - Dedicated Queue Toggle Button in player controls (auto-opens when playing, interactive toggle, idle gating)
 * - Extended 500px default height for 3 full rows without cut-off or scrollbars
 * - Automatic Queue Recovery on initial load & remote reconnects
 * - On the grid show: Single-select dropdown for "Playlists" or "Favorites"
 * - Show Media Labels: Toggle to show/hide text overlays on grid cover art
 * - Automated Track Queue Drawer (with 28px album art thumbnails, smooth accordion animation)
 * - Compact Media Player (Album Art, Artist, Title, Seekbar, Controls)
 * - Auto-Discovered Grid directly from Music Assistant with robust fallback paths
 * - 1-Tap Playback with dynamic service routing
 * - Sleek dark-mode styling matching Home Assistant Lovelace
 */

const MASS_CARD_VERSION = "3.9.1";

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

  _getSchema() {
    const style = this._config?.card_style || "unified";
    const isQueue = style === "queue";
    const isPlayer = style === "player";
    const isPlaylist = style === "playlist";

    const schema = [
      {
        name: "card_style",
        selector: {
          select: {
            options: [
              { value: "unified", label: "1. Unified (Player, Queue & Media Grid)" },
              { value: "player", label: "2. Media Player Only" },
              { value: "playlist", label: "3. Playlist / Media Grid Only" },
              { value: "queue", label: "4. Track Queue Only" }
            ],
            mode: "dropdown"
          }
        }
      },
      {
        name: "speaker_entity",
        required: true,
        selector: {
          entity: {
            domain: "media_player"
          }
        }
      }
    ];

    if (style === "unified" || isPlayer || isQueue) {
      schema.push({
        name: "queue_limit",
        selector: {
          number: {
            min: 1,
            max: isQueue ? 10 : 5,
            step: 1,
            mode: "slider"
          }
        }
      });
      schema.push({
        name: "hide_played_queue",
        selector: {
          boolean: {}
        }
      });
    }

    if (style === "unified" || isPlayer) {
      if (style === "unified") {
        schema.push({
          name: "show_player",
          selector: { boolean: {} }
        });
      }
      schema.push({
        name: "show_volume",
        selector: { boolean: {} }
      });
      schema.push({
        name: "show_queue",
        selector: { boolean: {} }
      });
    }

    if (style === "unified" || isPlaylist) {
      if (style === "unified") {
        schema.push({
          name: "show_playlists",
          selector: { boolean: {} }
        });
      }
      schema.push(
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
          name: "show_labels",
          selector: { boolean: {} }
        },
        {
          name: "max_height",
          selector: { text: {} }
        }
      );
    }

    schema.push(
      {
        name: "mass_url",
        selector: {
          text: {
            type: "url"
          }
        }
      },
      {
        name: "mass_token",
        selector: {
          text: {
            type: "password"
          }
        }
      }
    );

    return schema;
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
        this._render();
      });

      this.shadowRoot.appendChild(form);
    }

    const isQueue = (this._config?.card_style === "queue");
    form.schema = this._getSchema();
    form.computeLabel = (schema) => {
      const labels = {
        card_style: "Card Style",
        speaker_entity: "Media Player Entity",
        grid_content: "On the grid show",
        columns: "Grid Columns (default: 3)",
        limit: "Item Limit (0 = show all)",
        show_player: "Show Media Player Widget",
        show_volume: "Show Volume Slider",
        show_queue: "Auto-Show Track Queue (when playing)",
        show_playlists: "Show Media Grid",
        show_labels: "Show Media Labels on Grid",
        queue_limit: isQueue ? "Queue Visible Rows (1 - 10 rows)" : "Queue Visible Rows (1 - 5 rows)",
        hide_played_queue: "Clear Played Tracks from Queue",
        max_height: "Grid Max Height (default: 500px)",
        mass_url: "Music Assistant Server URL (optional, e.g. https://mass.majonomaki.com)",
        mass_token: "Music Assistant API Token (optional, for direct full queue sync)"
      };
      return labels[schema.name] || schema.name;
    };

    form.hass = this._hass;
    form.data = {
      card_style: "unified",
      grid_content: "playlists",
      columns: 3,
      show_player: true,
      show_volume: true,
      show_queue: true,
      show_playlists: true,
      show_labels: true,
      hide_played_queue: false,
      queue_limit: isQueue ? 10 : 5,
      limit: 0,
      max_height: "500px",
      mass_url: "",
      mass_token: "",
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
    this._allPlaylists = [];
    this._queueTracks = [];
    this._queueTotalCount = null;
    this._loaded = false;
    this._currentSpeaker = null;
    this._currentGridContent = null;
    this._activePlaylistId = null;
    this._fetchingQueue = false;
    this._ingressUrl = null;
    this._ingressAttempted = false;
    this._lastScrolledTrackKey = null;
    this._isDraggingVolume = false;
    this._userQueueToggle = null;
    this._lastPlayState = false;
    this._isSelectionMode = false;
    this._selectedPlaylists = [];
    this._lastMediaTitle = null;
  }

  static async getConfigElement() {
    return document.createElement("mass-player-card-editor");
  }

  static getStubConfig(hass, entities, entitiesFallback) {
    const mediaPlayers = Object.keys(hass.states).filter(eid => eid.startsWith("media_player."));
    const preferred = mediaPlayers.find(eid => eid.includes("speaker_group") || eid.includes("mass")) || mediaPlayers[0] || "";
    return {
      card_style: "unified",
      speaker_entity: preferred,
      grid_content: "playlists",
      columns: 3,
      show_player: true,
      show_volume: true,
      show_queue: true,
      show_playlists: true,
      show_labels: true,
      hide_played_queue: false,
      queue_limit: 5,
      limit: 0
    };
  }

  setConfig(config) {
    const speaker = config.speaker_entity || config.entity;
    if (!speaker) {
      throw new Error("Please specify 'speaker_entity' (e.g. media_player.home_speaker_group)");
    }
    
    const gridContent = config.grid_content || "playlists";
    const reloadNeeded = (this._currentSpeaker !== speaker || this._currentGridContent !== gridContent);
    this._currentSpeaker = speaker;
    this._currentGridContent = gridContent;

    const oldMassUrl = this._config?.mass_url;
    this._config = {
      card_style: "unified",
      grid_content: "playlists",
      columns: 3,
      show_player: true,
      show_volume: true,
      show_queue: true,
      show_playlists: true,
      show_labels: true,
      hide_played_queue: false,
      queue_limit: 5,
      limit: 0,
      mass_url: "",
      mass_token: "",
      ...config,
      speaker_entity: speaker,
      entity: speaker
    };

    if (reloadNeeded) {
      this._loaded = false;
      this._queueTracks = [];
      this._queueTotalCount = null;
      this._allPlaylists = [];
      this._playlists = [];
      if (this._hass) this.loadPlaylists();
    } else {
      // If mass_url changed, re-resolve images immediately
      if (oldMassUrl !== this._config.mass_url) {
        if (this._allPlaylists && this._allPlaylists.length > 0) {
          this._allPlaylists = this._allPlaylists.map(pl => ({
            ...pl,
            image: this.resolveImageUrl(pl.raw_thumbnail || pl.image)
          }));
        }
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
      }
      // Re-render live preview instantly in the GUI editor
      if (this._hass) {
        const stateObj = this._hass.states[this._config.speaker_entity];
        this.render(stateObj);
      }
    }
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
    const isPlaying = stateObj?.state === "playing";
    const currentTitle = stateObj?.attributes?.media_title || "";

    // Clear queue when player goes idle or off so next playback initiates fresh
    if (stateObj?.state === "idle" || stateObj?.state === "off") {
      if (this._queueTracks && this._queueTracks.length > 0) {
        this._queueTracks = [];
        this._queueTotalCount = null;
        this._lastMediaTitle = null;
        this._lastFailedSyncTitle = null;
      }
    }

    // Auto-detect and load queue on page load or remote reconnect if playing
    if (isPlaying && !this._fetchingQueue) {
      if (!this._queueTracks || this._queueTracks.length === 0) {
        this._autoLoadCurrentQueue(stateObj);
      } else if (currentTitle) {
        // Track validation: check if currently playing title exists in active queue
        const curTitleNorm = currentTitle.toLowerCase().trim();
        const found = this._queueTracks.some(t => {
          const tName = (t.name || "").toLowerCase().trim();
          return tName && (curTitleNorm === tName || curTitleNorm.includes(tName) || tName.includes(curTitleNorm));
        });
        if (!found && this._lastFailedSyncTitle !== currentTitle) {
          // Playing something not in our current queue, re-sync from server across devices
          this._lastFailedSyncTitle = currentTitle;
          this._autoLoadCurrentQueue(stateObj, true);
        } else if (found) {
          this._lastFailedSyncTitle = null;
        }
      }
    }
    this._lastMediaTitle = currentTitle;

    this.render(stateObj);
  }

  async initIngressSession() {
    if (this._ingressUrl) return this._ingressUrl;
    if (this._ingressPromise) return this._ingressPromise;

    this._ingressPromise = (async () => {
      // Prioritize official Supervisor add-on slugs first
      const candidateSlugs = [
        "d5369777_music_assistant",
        "d5369777_music_assistant_beta"
      ];

      if (this._hass && this._hass.panels) {
        const panels = Object.values(this._hass.panels);
        const massPanel = panels.find(panel => 
          (panel.url_path && (panel.url_path.includes("music_assistant") || panel.url_path.includes("mass"))) ||
          (panel.component_name && (panel.component_name.includes("music_assistant") || panel.component_name.includes("mass")))
        );
        if (massPanel) {
          if (massPanel.config && massPanel.config.ingress && !candidateSlugs.includes(massPanel.config.ingress)) {
            candidateSlugs.unshift(massPanel.config.ingress);
          }
          if (massPanel.url_path && !candidateSlugs.includes(massPanel.url_path)) {
            candidateSlugs.push(massPanel.url_path);
          }
        }
      }

      for (const slug of candidateSlugs) {
        try {
          let info = null;
          // Method 1: Hass.io REST API (standard HA frontend method)
          if (typeof this._hass.callApi === "function") {
            try {
              const res = await this._hass.callApi("GET", `hassio/addons/${slug}/info`);
              info = res?.data || res;
            } catch (_) {}
          }

          // Method 2: Supervisor WebSocket API bridge
          if (!info || !info.ingress_url) {
            try {
              const res = await this._hass.callWS({
                type: "supervisor/api",
                endpoint: `/addons/${slug}/info`,
                method: "get"
              });
              info = res?.data || res?.result || res;
            } catch (_) {}
          }

          // Method 3: Direct panel config inspection
          if (!info || !info.ingress_url) {
            const p = Object.values(this._hass.panels || {}).find(panel =>
              panel.config?.ingress === slug || panel.url_path === slug || (panel.config?.ingress_url && panel.url_path?.includes("music_assistant"))
            );
            if (p?.config?.ingress_url) {
              info = { ingress_url: p.config.ingress_url };
            }
          }

          if (info && info.ingress_url) {
            this._ingressUrl = info.ingress_url.endsWith('/') ? info.ingress_url : info.ingress_url + '/';
            
            // Bootstrap Ingress session cookies
            if (typeof this._hass.callApi === "function") {
              try {
                await this._hass.callApi("POST", "hassio/ingress/session");
              } catch (_) {}
            }
            try {
              await this._hass.callWS({
                type: "supervisor/api",
                endpoint: "/ingress/session",
                method: "post"
              });
            } catch (_) {}

            // Re-resolve existing items with newly discovered Ingress URL
            if (this._allPlaylists && this._allPlaylists.length > 0) {
              this._allPlaylists = this._allPlaylists.map(pl => ({
                ...pl,
                image: this.resolveImageUrl(pl.raw_thumbnail || pl.image)
              }));
            }
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
          console.debug(`[MASS-PLAYER-CARD] Ingress check failed for slug "${slug}":`, e);
        }
      }
      return null;
    })().finally(() => {
      this._ingressPromise = null;
    });

    return this._ingressPromise;
  }

  resolveImageUrl(url) {
    if (!url) return null;
    
    // 1. Fix the known Music Assistant size=0 bug (which triggers 400 Bad Request)
    let cleanUrl = url.replace(/([?&])size=0(&|$)/, '$1size=256$2');

    // 2. Relative HA proxy URL (like /api/media_player_proxy/...)
    if (cleanUrl.startsWith("/")) {
      return this._hass && typeof this._hass.hassUrl === "function" ? this._hass.hassUrl(cleanUrl) : cleanUrl;
    }

    // 3. User configured Music Assistant server URL (e.g. Cloudflare tunnel or reverse proxy)
    let massUrl = (this._config && this._config.mass_url) ? this._config.mass_url.trim().replace(/\/+$/, "") : "";

    // 4. Auto-infer Music Assistant domain if on a custom HTTPS domain (e.g. hass.domain.com -> mass.domain.com)
    if (!massUrl && window.location.protocol === "https:") {
      const host = window.location.hostname;
      const match = host.match(/^(?:hass|ha|homeassistant)\.(.+)$/i);
      if (match && match[1]) {
        massUrl = `https://mass.${match[1]}`;
      }
    }

    // 5. Rewrite Music Assistant imageproxy URLs
    if (cleanUrl.includes("imageproxy")) {
      const idx = cleanUrl.indexOf("imageproxy");
      const pathSuffix = cleanUrl.substring(idx);

      // If already a valid HTTPS URL (e.g. from MA External URL setting)
      if (cleanUrl.startsWith("https://")) {
        return cleanUrl;
      }

      if (massUrl) {
        return `${massUrl}/${pathSuffix}`;
      }

      if (this._ingressUrl) {
        const fullPath = this._ingressUrl + pathSuffix;
        return this._hass && typeof this._hass.hassUrl === "function" ? this._hass.hassUrl(fullPath) : fullPath;
      }

      // If on HTTPS (e.g. Nabu Casa remote connection / Cloudflare) and no tunnel/ingress configured:
      if (window.location.protocol === "https:") {
        // Upgrade http:// to https:// if host is a domain name rather than a raw IP
        if (cleanUrl.startsWith("http://")) {
          const matchHost = cleanUrl.match(/^http:\/\/([^:/]+)(:\d+)?\//);
          if (matchHost && !matchHost[1].match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
            return cleanUrl.replace(/^http:/, "https:");
          }
          // Raw local IP blocked by browser Mixed Content / CORS Private Network Access
          return null;
        }
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

    const isTargetFolder = (c) => {
      const t = (c.title || "").toLowerCase();
      const id = (c.media_content_id || "").toLowerCase();
      const mc = (c.media_class || "").toLowerCase();
      if (targetType === "favorites") {
        return t.includes("favorite") || id.includes("favorite") || t.includes("liked") || id.includes("liked") || t.includes("track") || id.includes("track");
      }
      return t.includes("playlist") || id.includes("playlist") || mc.includes("playlist");
    };

    if (speaker && this._hass) {
      try {
        const root = await this._hass.callWS({
          type: "media_player/browse_media",
          entity_id: speaker
        });

        if (root && root.children) {
          let folder = root.children.find(isTargetFolder);

          // If not found at root, check if nested under Music Assistant folder
          if (!folder) {
            const massFolder = root.children.find(c => {
              const t = (c.title || "").toLowerCase();
              const id = (c.media_content_id || "").toLowerCase();
              return t.includes("music assistant") || t.includes("mass") || id.includes("mass");
            });
            if (massFolder) {
              const subData = await this._hass.callWS({
                type: "media_player/browse_media",
                entity_id: speaker,
                media_content_id: massFolder.media_content_id,
                media_content_type: massFolder.media_content_type
              });
              if (subData && subData.children) {
                folder = subData.children.find(isTargetFolder);
              }
            }
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
        console.debug("[MASS-PLAYER-CARD] Standard browse_media query failed, checking fallback media sources:", err);
      }

      // Fallback A: Direct media-source or library URI
      if (discovered.length === 0) {
        const fallbackIds = targetType === "favorites"
          ? ["media-source://mass/library/tracks", "library://track"]
          : ["media-source://mass/library/playlists", "media-source://mass/playlists", "library://playlist"];
        for (const fId of fallbackIds) {
          try {
            const directData = await this._hass.callWS({
              type: "media_player/browse_media",
              entity_id: speaker,
              media_content_id: fId,
              media_content_type: targetType === "favorites" ? "track" : "playlist"
            });
            const items = extractItems(directData);
            if (items.length > 0) {
              discovered = items;
              break;
            }
          } catch (_) {}
        }
      }

      // Fallback B: Search other Music Assistant player entities in HA states
      if (discovered.length === 0 && this._hass.states) {
        const otherMassPlayers = Object.keys(this._hass.states).filter(eid => 
          eid.startsWith("media_player.") && eid !== speaker && (eid.includes("mass") || eid.includes("music_assistant"))
        );
        for (const otherEid of otherMassPlayers) {
          try {
            const oRoot = await this._hass.callWS({
              type: "media_player/browse_media",
              entity_id: otherEid
            });
            if (oRoot && oRoot.children) {
              let oFolder = oRoot.children.find(isTargetFolder);
              if (!oFolder) {
                const oMassFolder = oRoot.children.find(c => {
                  const t = (c.title || "").toLowerCase();
                  const id = (c.media_content_id || "").toLowerCase();
                  return t.includes("music assistant") || t.includes("mass") || id.includes("mass");
                });
                if (oMassFolder) {
                  const oSub = await this._hass.callWS({
                    type: "media_player/browse_media",
                    entity_id: otherEid,
                    media_content_id: oMassFolder.media_content_id,
                    media_content_type: oMassFolder.media_content_type
                  });
                  if (oSub && oSub.children) oFolder = oSub.children.find(isTargetFolder);
                }
              }
              if (oFolder) {
                const oData = await this._hass.callWS({
                  type: "media_player/browse_media",
                  entity_id: otherEid,
                  media_content_id: oFolder.media_content_id,
                  media_content_type: oFolder.media_content_type
                });
                const items = extractItems(oData);
                if (items.length > 0) {
                  discovered = items;
                  break;
                }
              }
            }
          } catch (_) {}
        }
      }
    }

    this._allPlaylists = discovered;

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
      this._playlists = [];
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

      const isAlbum = item.media_content_type === "album" || item.media_class === "album";
      const playlistThumb = item.raw_thumbnail || item.image || null;

      if (data && data.children && data.children.length > 0) {
        this._queueTracks = data.children.map(t => {
          // For albums, all tracks legitimately share the album art.
          // For playlists, avoid stamping the playlist cover onto individual tracks.
          let rawThumb = t.thumbnail || t.image || t.media_image || null;
          if (!rawThumb && isAlbum) {
            rawThumb = playlistThumb;
          }
          if (!isAlbum && rawThumb && (rawThumb === playlistThumb || rawThumb === item.thumbnail)) {
            rawThumb = null;
          }
          return {
            name: t.title,
            artist: t.media_artist || "",
            duration: t.duration ? formatDuration(t.duration) : "",
            media_id: t.media_content_id || t.title,
            media_content_type: t.media_content_type || "track",
            raw_thumbnail: rawThumb,
            image: rawThumb ? this.resolveImageUrl(rawThumb) : null
          };
        });
        this._queueTotalCount = data.children.length;
        window.__mass_player_card_queue = window.__mass_player_card_queue || {};
        window.__mass_player_card_queue[speaker] = this._queueTracks;
        try {
          localStorage.setItem('mass_queue_' + speaker, JSON.stringify(this._queueTracks));
          localStorage.setItem('mass_playlist_' + speaker, JSON.stringify(item));
        } catch (_) {}
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
        this._queueTotalCount = 1;
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

  fetchQueue(force = false) {
    const stateObj = this._hass?.states[this._config?.speaker_entity];
    if (stateObj) {
      return this._autoLoadCurrentQueue(stateObj, force);
    }
    return Promise.resolve();
  }

  async _autoLoadCurrentQueue(stateObj, force = false) {
    if ((this._fetchingQueue && !force) || !stateObj) return;
    this._fetchingQueue = true;
    await this.initIngressSession();
    const attr = stateObj.attributes || {};
    const speaker = this._config.speaker_entity;

    const extractThumb = (item) => {
      if (!item) return null;
      return (
        item.media_item?.album?.image ||
        (Array.isArray(item.media_item?.metadata?.images) ? (item.media_item.metadata.images.find(img => img.type === "thumb" || img.type === "album")?.path || item.media_item.metadata.images[0]?.path) : null) ||
        item.thumbnail ||
        item.image ||
        item.media_image ||
        item.media_item?.image ||
        item.media_item?.thumbnail ||
        null
      );
    };

    try {
      // 0. Shared memory and localStorage queue cache across card instances (strictly validate against active track)
      if (!force && (!this._queueTracks || this._queueTracks.length <= 2) && speaker) {
        const curTitle = (attr.media_title || "").toLowerCase().trim();
        const matchesCurrentTrack = (trackList) => {
          if (!curTitle || !Array.isArray(trackList) || trackList.length === 0) return false;
          return trackList.some(t => {
            const tName = (t.name || "").toLowerCase().trim();
            return tName && (curTitle === tName || curTitle.includes(tName) || tName.includes(curTitle));
          });
        };

        const sharedQueue = window.__mass_player_card_queue?.[speaker] || null;
        if (sharedQueue && Array.isArray(sharedQueue) && sharedQueue.length > 2 && matchesCurrentTrack(sharedQueue)) {
          this._queueTracks = sharedQueue;
          this._queueTotalCount = sharedQueue.length;
          const currentState = this._hass?.states[this._config.speaker_entity];
          this.render(currentState);
          return;
        }
        try {
          const cachedJson = localStorage.getItem('mass_queue_' + speaker);
          if (cachedJson) {
            const parsed = JSON.parse(cachedJson);
            if (Array.isArray(parsed) && parsed.length > 2 && matchesCurrentTrack(parsed)) {
              this._queueTracks = parsed;
              this._queueTotalCount = parsed.length;
              const currentState = this._hass?.states[this._config.speaker_entity];
              this.render(currentState);
              return;
            }
          }
        } catch (_) {}
      }

      // 1. High-priority: mass_queue integration (droans/mass_queue get_queue_items)
      if (speaker && this._hass) {
        try {
          const res = await this._hass.callWS({
            type: "call_service",
            domain: "mass_queue",
            service: "get_queue_items",
            service_data: { entity: speaker, limit: 100 },
            return_response: true
          });
          const rawItems = Array.isArray(res)
            ? res
            : Array.isArray(res?.response)
            ? res.response
            : Array.isArray(res?.response?.[speaker])
            ? res.response[speaker]
            : Array.isArray(res?.[speaker])
            ? res[speaker]
            : (res?.response?.items || res?.items || []);

          if (Array.isArray(rawItems) && rawItems.length > 0) {
            this._queueTracks = rawItems.map((t, idx) => {
              const rawThumb = extractThumb(t);
              return {
                name: t.media_title || t.title || t.name || t.media_item?.name || `Track ${idx + 1}`,
                artist: t.media_artist || t.artist || t.media_item?.artists?.[0]?.name || t.media_item?.artist || "",
                duration: t.media_duration ? formatDuration(t.media_duration) : (t.duration ? formatDuration(t.duration) : ""),
                queue_item_id: t.queue_item_id || t.item_id || null,
                media_id: t.media_content_id || t.queue_item_id || t.item_id || t.media_item?.uri || t.title || t.name,
                media_content_type: "track",
                raw_thumbnail: rawThumb,
                image: this.resolveImageUrl(rawThumb) || null
              };
            });
            this._queueTotalCount = this._queueTracks.length;
            window.__mass_player_card_queue = window.__mass_player_card_queue || {};
            window.__mass_player_card_queue[speaker] = this._queueTracks;
            try {
              localStorage.setItem('mass_queue_' + speaker, JSON.stringify(this._queueTracks));
            } catch (_) {}
            const currentState = this._hass?.states[this._config.speaker_entity];
            this.render(currentState);
            return;
          }
        } catch (mqErr) {
          console.debug("[MASS-PLAYER-CARD] mass_queue.get_queue_items service unavailable or failed:", mqErr);
        }
      }

      // 2. Direct Music Assistant API call for player_queues/items via mass_queue.send_command or Ingress/REST endpoint
      if (speaker && this._hass) {
        try {
          const possibleQueueIds = [
            attr.active_queue,
            attr.mass_player_id,
            speaker.replace(/^media_player\./, ""),
            speaker
          ].filter(Boolean);

          let items = null;

          // Method A: mass_queue.send_command bridge
          for (const qId of possibleQueueIds) {
            try {
              const cmdRes = await this._hass.callWS({
                type: "call_service",
                domain: "mass_queue",
                service: "send_command",
                service_data: {
                  command: "player_queues/items",
                  args: { queue_id: qId, limit: 100 }
                },
                return_response: true
              });
              const data = cmdRes?.response || cmdRes;
              const raw = data?.result || data?.items || (Array.isArray(data) ? data : null);
              if (Array.isArray(raw) && raw.length > 0) {
                items = raw;
                break;
              }
            } catch (_) {}
          }

          // Method B: Direct Ingress or mass_url REST endpoint with token auth support
          if (!items && (this._ingressUrl || this._config.mass_url)) {
            const endpoints = [];
            if (this._ingressUrl) endpoints.push(this._ingressUrl.replace(/\/+$/, ""));
            if (this._config.mass_url) endpoints.push(this._config.mass_url.trim().replace(/\/+$/, ""));

            for (const base of endpoints) {
              if (items && items.length > 0) break;
              const headers = { "Content-Type": "application/json" };
              if (this._config.mass_token) {
                headers["Authorization"] = `Bearer ${this._config.mass_token.trim()}`;
              } else if (this._hass?.auth?.data?.access_token) {
                headers["Authorization"] = `Bearer ${this._hass.auth.data.access_token}`;
              }

              for (const qId of possibleQueueIds) {
                try {
                  const fetchRes = await fetch(`${base}/api`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                      message_id: Date.now(),
                      command: "player_queues/items",
                      args: { queue_id: qId, limit: 100 }
                    })
                  });
                  if (fetchRes.ok) {
                    const json = await fetchRes.json();
                    const raw = json?.result || json?.response || json?.items || (Array.isArray(json) ? json : null);
                    if (Array.isArray(raw) && raw.length > 0) {
                      items = raw;
                      break;
                    }
                  }
                } catch (_) {}
              }
            }
          }

          if (Array.isArray(items) && items.length > 0) {
            this._queueTracks = items.map((t, idx) => {
              const rawThumb = extractThumb(t);
              return {
                name: t.name || t.media_title || t.title || t.media_item?.name || `Track ${idx + 1}`,
                artist: t.artist || t.media_artist || t.media_item?.artists?.[0]?.name || t.media_item?.artist || "",
                duration: t.duration ? formatDuration(t.duration) : (t.media_duration ? formatDuration(t.media_duration) : ""),
                queue_item_id: t.queue_item_id || t.item_id || null,
                media_id: t.queue_item_id || t.item_id || t.media_item?.uri || t.name,
                media_content_type: "track",
                raw_thumbnail: rawThumb,
                image: this.resolveImageUrl(rawThumb) || null
              };
            });
            this._queueTotalCount = this._queueTracks.length;
            window.__mass_player_card_queue = window.__mass_player_card_queue || {};
            window.__mass_player_card_queue[speaker] = this._queueTracks;
            try {
              localStorage.setItem('mass_queue_' + speaker, JSON.stringify(this._queueTracks));
            } catch (_) {}
            const currentState = this._hass?.states[this._config.speaker_entity];
            this.render(currentState);
            return;
          }
        } catch (apiErr) {
          console.debug("[MASS-PLAYER-CARD] player_queues/items API call failed:", apiErr);
        }
      }

      // 3. Fallback: Native music_assistant get_queue action
      if (speaker && this._hass) {
        try {
          let res = null;
          try {
            res = await this._hass.callWS({
              type: "call_service",
              domain: "music_assistant",
              service: "get_queue",
              service_data: { entity_id: speaker },
              return_response: true
            });
          } catch (_) {
            try {
              res = await this._hass.callWS({
                type: "call_service",
                domain: "mass",
                service: "get_queue",
                service_data: { entity_id: speaker },
                return_response: true
              });
            } catch (_) {}
          }

          const qData = res?.response?.[speaker] || res?.response || res?.[speaker] || res;
          if (qData) {
            // Store total count if reported by server
            if (typeof qData.items === 'number') {
              this._queueTotalCount = qData.items;
            } else if (typeof qData.item_count === 'number') {
              this._queueTotalCount = qData.item_count;
            } else if (typeof qData.total_items === 'number') {
              this._queueTotalCount = qData.total_items;
            } else if (Array.isArray(qData?.items)) {
              this._queueTotalCount = qData.items.length;
            }

            const extractThumb = (item) => {
              if (!item) return null;
              return (
                item.image ||
                item.thumbnail ||
                item.media_image ||
                item.media_item?.image ||
                item.media_item?.thumbnail ||
                item.media_item?.album?.image ||
                (Array.isArray(item.media_item?.metadata?.images) ? item.media_item.metadata.images[0]?.path : null) ||
                null
              );
            };

            const rawItems = Array.isArray(qData)
              ? qData
              : (Array.isArray(qData?.items) ? qData.items : (Array.isArray(qData?.queue_items) ? qData.queue_items : null));
            if (rawItems && rawItems.length > 0) {
              this._queueTracks = rawItems.map((t, idx) => {
                const rawThumb = extractThumb(t);
                return {
                  name: t.title || t.name || t.media_item?.name || `Track ${idx + 1}`,
                  artist: t.artist || t.media_item?.artists?.[0]?.name || t.media_item?.artist || "",
                  duration: t.duration ? formatDuration(t.duration) : "",
                  queue_item_id: t.queue_item_id || t.item_id || null,
                  media_id: t.queue_item_id || t.item_id || t.media_item?.uri || t.title || t.name,
                  media_content_type: "track",
                  raw_thumbnail: rawThumb,
                  image: this.resolveImageUrl(rawThumb) || null
                };
              });
              const currentState = this._hass?.states[this._config.speaker_entity];
              this.render(currentState);
              return;
            }

            // If get_queue provided current_item and/or next_item
            const currentItem = qData.current_item;
            const nextItem = qData.next_item;
            if (currentItem || nextItem) {
              const partialTracks = [];
              if (currentItem) {
                const rawThumb = extractThumb(currentItem);
                partialTracks.push({
                  name: currentItem.name || currentItem.title || currentItem.media_item?.name || "Current Track",
                  artist: currentItem.artist || currentItem.media_item?.artists?.[0]?.name || currentItem.media_item?.artist || "",
                  duration: currentItem.duration ? formatDuration(currentItem.duration) : "",
                  queue_item_id: currentItem.queue_item_id || null,
                  media_id: currentItem.queue_item_id || currentItem.media_item?.uri || currentItem.name,
                  media_content_type: "track",
                  raw_thumbnail: rawThumb,
                  image: this.resolveImageUrl(rawThumb) || null
                });
              }
              if (nextItem) {
                const rawThumb = extractThumb(nextItem);
                partialTracks.push({
                  name: nextItem.name || nextItem.title || nextItem.media_item?.name || "Next Track",
                  artist: nextItem.artist || nextItem.media_item?.artists?.[0]?.name || nextItem.media_item?.artist || "",
                  duration: nextItem.duration ? formatDuration(nextItem.duration) : "",
                  queue_item_id: nextItem.queue_item_id || null,
                  media_id: nextItem.queue_item_id || nextItem.media_item?.uri || nextItem.name,
                  media_content_type: "track",
                  raw_thumbnail: rawThumb,
                  image: this.resolveImageUrl(rawThumb) || null
                });
              }
              if (partialTracks.length > 0) {
                // If we do not already have a richer queue list, populate with partialTracks
                if (!this._queueTracks || this._queueTracks.length <= partialTracks.length) {
                  this._queueTracks = partialTracks;
                }
                const currentState = this._hass?.states[this._config.speaker_entity];
                this.render(currentState);
                // Do NOT early return here; allow Method 4 to attempt matching full playlist below!
              }
            }
          }
        } catch (queueErr) {
          console.debug("[MASS-PLAYER-CARD] get_queue service not available or returned no items:", queueErr);
        }
      }

      // 4. Fallback: match currently playing media against discovered playlists
      const album = (attr.media_album_name || "").toLowerCase().trim();
      const plAttr = (attr.media_playlist || "").toLowerCase().trim();
      const currentTitle = (attr.media_title || "").toLowerCase().trim();
      const currentArtist = (attr.media_artist || "").toLowerCase().trim();

      const candidateLists = (this._allPlaylists && this._allPlaylists.length > 0) ? this._allPlaylists : this._playlists;
      let targetItem = null;
      if (candidateLists && candidateLists.length > 0) {
        // Priority A: match by album or playlist name attribute
        targetItem = candidateLists.find(p => {
          const n = (p.name || "").toLowerCase().trim();
          if (!n) return false;
          return (
            (album && (album === n || album.includes(n) || n.includes(album))) ||
            (plAttr && (plAttr === n || plAttr.includes(n) || n.includes(plAttr)))
          );
        });

        // Priority B: match by current track title
        if (!targetItem && currentTitle) {
          targetItem = candidateLists.find(p => {
            const n = (p.name || "").toLowerCase().trim();
            return n && (n === currentTitle || n.includes(currentTitle) || currentTitle.includes(n));
          });
        }

        // Priority C: match by artist name (e.g. "Brothertiger" in "This is Brothertiger" or "Brothertiger Radio")
        if (!targetItem && currentArtist) {
          targetItem = candidateLists.find(p => {
            const n = (p.name || "").toLowerCase().trim();
            return n && (n.includes(currentArtist) || currentArtist.includes(n));
          });
        }
      }

      // Check cached playlist ONLY if it strictly relates to the current active media
      if (!targetItem && !force) {
        try {
          const cachedPlJson = localStorage.getItem('mass_playlist_' + speaker);
          if (cachedPlJson) {
            const plObj = JSON.parse(cachedPlJson);
            if (plObj && plObj.name) {
              const plName = plObj.name.toLowerCase().trim();
              const isRelevant = (
                (album && (album.includes(plName) || plName.includes(album))) ||
                (plAttr && (plAttr.includes(plName) || plName.includes(plAttr))) ||
                (currentArtist && (plName.includes(currentArtist) || currentArtist.includes(plName))) ||
                (currentTitle && (plName.includes(currentTitle) || currentTitle.includes(plName)))
              );
              if (isRelevant && plObj.media_id) {
                targetItem = plObj;
              }
            }
          }
        } catch (_) {}
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
                if (!n) return false;
                return (
                  (album && (album.includes(n) || n.includes(album))) ||
                  (plAttr && (plAttr.includes(n) || n.includes(plAttr))) ||
                  (currentArtist && (n.includes(currentArtist) || currentArtist.includes(n))) ||
                  (currentTitle && (n.includes(currentTitle) || currentTitle.includes(n)))
                );
              });
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
    const limit = Number(this._config.limit) || 0;
    const allItems = (this._allPlaylists && this._allPlaylists.length > 0) ? this._allPlaylists : (this._playlists || []);
    const playlists = (limit > 0) ? allItems.slice(0, limit) : allItems;

    const cardStyle = this._config.card_style || "unified";
    const isQueueStyle = cardStyle === "queue";
    const isPlayerStyle = cardStyle === "player";
    const isPlaylistStyle = cardStyle === "playlist";

    let showPlayer = this._config.show_player !== false;
    let showVolume = this._config.show_volume !== false;
    let showQueue = this._config.show_queue !== false;
    let showPlaylists = this._config.show_playlists !== false;

    if (isPlayerStyle) {
      showPlayer = true;
      showPlaylists = false;
      showQueue = this._config.show_queue !== false;
    } else if (isPlaylistStyle) {
      showPlayer = false;
      showPlaylists = true;
      showQueue = false;
    } else if (isQueueStyle) {
      showPlayer = false;
      showPlaylists = false;
      showQueue = true;
    }

    const showLabels = this._config.show_labels !== false;
    const cols = Number(this._config.columns) || 3;
    const maxHeight = this._config.max_height || '500px';

    // Queue limit calculation (unified & player: 1-5, queue: 1-10)
    const maxAllowed = isQueueStyle ? 10 : 5;
    const defaultLimit = isQueueStyle ? 10 : 5;
    let rawQueueLimit = Number(this._config.queue_limit);
    const queueLimit = (isNaN(rawQueueLimit) || rawQueueLimit <= 0) ? defaultLimit : Math.min(maxAllowed, Math.max(1, rawQueueLimit));

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

    const totalInQueue = this._queueTotalCount || rawQueue.length;
    const remainingInQueue = queueTracks.length;
    const queueListMaxHeight = isQueueStyle ? 480 : Math.round(queueLimit * 35.5);

    // Auto-open on transition from stopped/idle to playing
    if (this._lastPlayState !== undefined && !this._lastPlayState && isPlaying) {
      this._userQueueToggle = true;
    }
    this._lastPlayState = isPlaying;

    let isQueueOpen = false;
    if (isQueueStyle) {
      isQueueOpen = true;
    } else if (showQueue) {
      if (this._userQueueToggle !== null) {
        isQueueOpen = this._userQueueToggle && isPlaying;
      } else {
        isQueueOpen = isPlaying && queueTracks.length > 0;
      }
    }

    let queueCountLabel = `${remainingInQueue} tracks`;
    if (remainingInQueue === 0) {
      queueCountLabel = '0 tracks';
    } else if (hidePlayed && currentTrackIdx >= 0) {
      if (totalInQueue > remainingInQueue) {
        queueCountLabel = `${remainingInQueue} remaining • ${totalInQueue} total`;
      } else {
        queueCountLabel = `${remainingInQueue} tracks`;
      }
    } else {
      queueCountLabel = `${remainingInQueue} tracks`;
    }

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

        /* Playback Mode & Queue Buttons */
        .mode-btn, .queue-btn {
          color: var(--secondary-text-color, #8e8e93);
          position: relative;
        }
        .mode-btn.mode-active, .queue-btn.queue-active {
          color: var(--primary-color, #03a9f4);
        }
        .queue-btn.queue-disabled {
          opacity: 0.3;
          cursor: default;
          pointer-events: none;
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
        .queue-drawer.queue-standalone {
          max-height: none !important;
          opacity: 1 !important;
          margin-top: 0 !important;
          margin-bottom: 0 !important;
        }
        .queue-drawer.queue-standalone .queue-list {
          max-height: 480px;
        }
        .queue-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
          text-align: center;
          color: var(--secondary-text-color, #a0a0a0);
          gap: 10px;
        }
        .queue-empty-state svg {
          width: 38px;
          height: 38px;
          fill: var(--secondary-text-color, #707070);
          opacity: 0.6;
        }
        .queue-empty-state span {
          font-size: 13px;
          font-weight: 500;
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

        /* Grid Header & Multi-Selection Controls */
        .grid-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 2px 4px 10px 4px;
        }
        .grid-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .grid-section-title {
          font-size: 0.70rem;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: var(--secondary-text-color, #a0a0a0);
        }
        .selection-count {
          font-size: 0.70rem;
          font-weight: 600;
          color: var(--primary-color, #03a9f4);
          background-color: rgba(3, 169, 244, 0.15);
          padding: 1px 7px;
          border-radius: 8px;
        }
        .grid-header-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pill-btn {
          background-color: var(--secondary-background-color, rgba(255, 255, 255, 0.08));
          color: var(--primary-text-color, #ffffff);
          border: 1px solid var(--ha-card-border-color, var(--divider-color, rgba(255, 255, 255, 0.12)));
          border-radius: 14px;
          font-size: 0.72rem;
          font-weight: 600;
          padding: 3px 10px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
          transition: background-color 0.2s, border-color 0.2s, color 0.2s, transform 0.1s;
        }
        .pill-btn svg {
          width: 14px;
          height: 14px;
          fill: currentColor;
        }
        .pill-btn:hover {
          background-color: var(--primary-color, #03a9f4);
          border-color: var(--primary-color, #03a9f4);
          color: #ffffff;
        }
        .pill-btn:active {
          transform: scale(0.96);
        }
        .cancel-pill-btn {
          color: var(--secondary-text-color, #a0a0a0);
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

        /* Selection Badges on Tiles */
        .tile.tile-selection-mode {
          border-color: rgba(255, 255, 255, 0.15);
        }
        .tile.tile-selected {
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 12px rgba(3, 169, 244, 0.45);
        }
        .selection-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 700;
          z-index: 10;
          box-sizing: border-box;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .selection-badge.badge-empty {
          background-color: rgba(0, 0, 0, 0.45);
          border: 1.5px solid rgba(255, 255, 255, 0.6);
          backdrop-filter: blur(4px);
        }
        .selection-badge.badge-active {
          background-color: var(--primary-color, #03a9f4);
          color: #ffffff;
          border: 1.5px solid #ffffff;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
          transform: scale(1.05);
        }

        /* Docked Selection Action Bar */
        .selection-action-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: 12px;
          padding: 8px 12px;
          background-color: rgba(28, 28, 30, 0.95);
          border: 1px solid var(--primary-color, #03a9f4);
          border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
          backdrop-filter: blur(8px);
          animation: slideUpFade 0.25s ease-out;
        }
        @keyframes slideUpFade {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .action-btn {
          border-radius: 8px;
          font-size: 0.82rem;
          font-weight: 600;
          padding: 8px 14px;
          cursor: pointer;
          border: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background-color 0.2s, transform 0.1s, opacity 0.2s;
        }
        .action-btn svg {
          width: 18px;
          height: 18px;
          fill: currentColor;
        }
        .action-btn:active {
          transform: scale(0.96);
        }
        .action-btn.cancel-btn {
          background-color: rgba(255, 255, 255, 0.1);
          color: var(--primary-text-color, #ffffff);
        }
        .action-btn.cancel-btn:hover {
          background-color: rgba(255, 255, 255, 0.18);
        }
        .action-btn.play-selected-btn {
          background-color: var(--primary-color, #03a9f4);
          color: #ffffff;
          flex: 1;
          justify-content: center;
        }
        .action-btn.play-selected-btn:hover {
          filter: brightness(1.15);
        }
        .action-btn.play-selected-btn.disabled {
          opacity: 0.4;
          cursor: not-allowed;
          filter: none;
        }
      </style>

      <div class="unified-card">
        <!-- TOP: Player Section -->
        <div class="player-section" style="${showPlayer ? '' : 'display:none;'}">
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
              <button class="ctrl-btn queue-btn ${isQueueOpen ? 'queue-active' : ''} ${!isPlaying ? 'queue-disabled' : ''}" id="queueToggleBtn" title="${!isPlaying ? 'Queue inactive (idle)' : isQueueOpen ? 'Hide Queue' : 'Show Queue'}">
                <svg viewBox="0 0 24 24"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
              </button>
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

        <!-- MIDDLE: Track Queue Drawer / Standalone View -->
        <div class="queue-drawer ${isQueueOpen ? 'queue-open' : 'queue-closed'} ${isQueueStyle ? 'queue-standalone' : ''}" style="${(showQueue || isQueueStyle) ? '' : 'display:none;'}">
          <div class="queue-header">
            <span class="queue-title">UPCOMING QUEUE</span>
            <span class="queue-count">${queueCountLabel}</span>
          </div>
          ${queueTracks.length === 0 ? `
            <div class="queue-empty-state">
              <svg viewBox="0 0 24 24"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
              <span>Queue is idle. Start playback to view upcoming tracks.</span>
            </div>
          ` : `
            <div class="queue-list" style="max-height: ${queueListMaxHeight}px;">
              ${queueTracks.map((t, idx) => {
                const isCurrent = t.is_playing;
                const thumbImg = isCurrent ? (picture || t.image) : t.image;
                return `
                  <div class="queue-item ${isCurrent ? 'active-track' : ''}" data-track-idx="${idx}" title="Play ${t.name}">
                    <div class="queue-item-left">
                      <span class="queue-idx">${t.is_playing ? `<span class="playing-equalizer"><span></span><span></span><span></span></span>` : t.original_idx}</span>
                      <div class="queue-thumb">
                        ${thumbImg ? `<img class="queue-thumb-img" src="${thumbImg}" alt="" loading="lazy" onerror="this.style.display='none'; const s = this.nextElementSibling; if (s) s.style.display='block';" />` : ''}
                        <svg viewBox="0 0 24 24" style="${thumbImg ? 'display:none;' : ''}"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
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
          `}
        </div>

        <!-- SUBTLE SEPARATOR LINE -->
        <div class="divider-line" style="${(showPlayer && showPlaylists) ? '' : 'display:none;'}"></div>

        <!-- GRID HEADER & MULTI-SELECTION CONTROLS -->
        <div class="grid-header" style="${showPlaylists ? 'display: flex;' : 'display: none;'}">
          <div class="grid-header-left">
            <span class="grid-section-title">${this._isSelectionMode ? 'SELECT PLAYLISTS TO QUEUE' : (this._config.grid_content === 'favorites' ? 'FAVORITES' : 'PLAYLISTS')}</span>
            ${this._isSelectionMode ? `<span class="selection-count">${this._selectedPlaylists.length} selected</span>` : ''}
          </div>
          <div class="grid-header-right">
            ${!this._isSelectionMode ? `
              <button class="pill-btn select-mode-btn" id="startSelectBtn" title="Select multiple playlists to play sequentially or blend together">
                <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                <span>Select to Queue</span>
              </button>
            ` : `
              <button class="pill-btn select-all-btn" id="selectAllBtn" title="Select all playlists in order">
                ${this._selectedPlaylists.length === playlists.length && playlists.length > 0 ? 'Deselect All' : 'Select All'}
              </button>
              <button class="pill-btn cancel-pill-btn" id="cancelSelectBtn" title="Cancel selection">Cancel</button>
            `}
          </div>
        </div>

        <!-- BOTTOM: Media Grid Section -->
        <div class="grid-container" style="${showPlaylists ? '' : 'display:none;'}">
          ${playlists.length === 0 ? `<div style="grid-column: 1 / -1; text-align: center; padding: 24px 8px; color: var(--secondary-text-color, #a0a0a0); font-size: 13px;">No media found on this entity.</div>` : playlists.map((pl, idx) => {
            const isSelected = this._selectedPlaylists.some(p => (p.media_id && p.media_id === pl.media_id) || (p.name && p.name === pl.name));
            const selectIndex = isSelected ? this._selectedPlaylists.findIndex(p => (p.media_id && p.media_id === pl.media_id) || (p.name && p.name === pl.name)) + 1 : 0;
            return `
              <div class="tile ${this._isSelectionMode ? 'tile-selection-mode' : ''} ${isSelected ? 'tile-selected' : ''}" data-index="${idx}" title="${pl.name}">
                ${this._isSelectionMode ? `
                  <div class="selection-badge ${isSelected ? 'badge-active' : 'badge-empty'}">
                    ${isSelected ? selectIndex : ''}
                  </div>
                ` : ''}
                ${pl.image ? `<img class="tile-img" src="${pl.image}" alt="${pl.name}" loading="lazy" onerror="this.style.display='none'; const ic = this.parentElement.querySelector('.tile-icon'); if (ic) ic.style.display='block';" />` : ''}
                <svg class="tile-icon" viewBox="0 0 24 24" style="${pl.image ? 'display:none;' : ''}"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                ${showLabels ? `<div class="tile-title">${pl.name}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <!-- DOCKED SELECTION ACTION BAR -->
        ${this._isSelectionMode && showPlaylists ? `
          <div class="selection-action-bar">
            <button class="action-btn cancel-btn" id="actionBarCancelBtn">Cancel</button>
            <button class="action-btn play-selected-btn ${this._selectedPlaylists.length === 0 ? 'disabled' : ''}" id="actionBarPlayBtn">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <span>Play Selected ${this._selectedPlaylists.length > 0 ? `(${this._selectedPlaylists.length})` : ''}</span>
            </button>
          </div>
        ` : ''}
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

    // Queue Toggle Button
    const queueToggleBtn = this.shadowRoot.getElementById('queueToggleBtn');
    if (queueToggleBtn) {
      queueToggleBtn.onclick = () => {
        if (!isPlaying) return;
        this._userQueueToggle = !isQueueOpen;
        this.render(this._hass?.states[this._config?.speaker_entity]);
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
        if (this._isSelectionMode) {
          const existingIdx = this._selectedPlaylists.findIndex(p => (p.media_id && p.media_id === item.media_id) || (p.name && p.name === item.name));
          if (existingIdx >= 0) {
            this._selectedPlaylists.splice(existingIdx, 1);
          } else {
            this._selectedPlaylists.push(item);
          }
          this.render(this._hass?.states[this._config?.speaker_entity]);
          return;
        }
        this.playPlaylist(item);
      };
    });

    // Multi-Selection Controls
    const startSelectBtn = this.shadowRoot.getElementById('startSelectBtn');
    if (startSelectBtn) {
      startSelectBtn.onclick = () => {
        this._isSelectionMode = true;
        this._selectedPlaylists = [];
        this.render(this._hass?.states[this._config?.speaker_entity]);
      };
    }

    const cancelSelectBtn = this.shadowRoot.getElementById('cancelSelectBtn');
    if (cancelSelectBtn) {
      cancelSelectBtn.onclick = () => {
        this._isSelectionMode = false;
        this._selectedPlaylists = [];
        this.render(this._hass?.states[this._config?.speaker_entity]);
      };
    }

    const selectAllBtn = this.shadowRoot.getElementById('selectAllBtn');
    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        if (this._selectedPlaylists.length === playlists.length && playlists.length > 0) {
          this._selectedPlaylists = [];
        } else {
          this._selectedPlaylists = [...playlists];
        }
        this.render(this._hass?.states[this._config?.speaker_entity]);
      };
    }

    const actionBarCancelBtn = this.shadowRoot.getElementById('actionBarCancelBtn');
    if (actionBarCancelBtn) {
      actionBarCancelBtn.onclick = () => {
        this._isSelectionMode = false;
        this._selectedPlaylists = [];
        this.render(this._hass?.states[this._config?.speaker_entity]);
      };
    }

    const actionBarPlayBtn = this.shadowRoot.getElementById('actionBarPlayBtn');
    if (actionBarPlayBtn) {
      actionBarPlayBtn.onclick = () => {
        if (this._selectedPlaylists.length === 0) return;
        const toPlay = [...this._selectedPlaylists];
        this._isSelectionMode = false;
        this._selectedPlaylists = [];
        this._userQueueToggle = true;
        this.playMultiplePlaylists(toPlay);
        this.render(this._hass?.states[this._config?.speaker_entity]);
      };
    }

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

  async playMultiplePlaylists(items) {
    if (!items || items.length === 0) return;
    const speaker = this._config.speaker_entity;
    const targetType = this._config.grid_content || "playlists";

    console.log(`[MASS-PLAYER-CARD v${MASS_CARD_VERSION}] Enqueuing ${items.length} playlists on ${speaker}:`, items);

    // Auto-open queue and load queue for first item
    this._userQueueToggle = true;
    this.loadQueueForPlaylist(items[0]);

    const hasMusicAssistantAction = this._hass.services &&
      this._hass.services.music_assistant &&
      this._hass.services.music_assistant.play_media;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mediaType = item.media_content_type || (targetType === "favorites" ? "track" : "playlist");
      const enqueueMode = (i === 0) ? "play" : "add";

      if (hasMusicAssistantAction) {
        await this._hass.callService("music_assistant", "play_media", {
          media_type: mediaType,
          media_id: item.media_id || item.name,
          enqueue: enqueueMode
        }, { entity_id: speaker });
      } else {
        await this._hass.callService("media_player", "play_media", {
          media_content_type: mediaType,
          media_content_id: item.media_id || item.name,
          enqueue: enqueueMode,
          extra: { enqueue: enqueueMode }
        }, { entity_id: speaker });
      }

      if (i < items.length - 1) {
        await new Promise(r => setTimeout(r, 250));
      }
    }

    // Refresh queue after loading
    setTimeout(() => {
      this.fetchQueue();
    }, 1000);
  }

  playPlaylist(item) {
    const speaker = this._config.speaker_entity;
    const targetType = this._config.grid_content || "playlists";
    const mediaType = item.media_content_type || (targetType === "favorites" ? "track" : "playlist");

    console.log(`[MASS-PLAYER-CARD v${MASS_CARD_VERSION}] Playing ${mediaType} on ${speaker}:`, item);

    // Auto-open queue when starting playback
    this._userQueueToggle = true;

    // Instant preview for immediate responsive feedback
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

    // Sync official queue from server once Music Assistant ingests the playlist
    setTimeout(() => {
      this.fetchQueue(true);
    }, 1200);
  }

  playTrack(track) {
    const speaker = this._config.speaker_entity;
    console.log(`[MASS-PLAYER-CARD v${MASS_CARD_VERSION}] Playing queue track on ${speaker}:`, track);

    // If track has a queue_item_id and mass_queue integration is available, jump directly
    if (track.queue_item_id && this._hass?.services?.mass_queue?.play_queue_item) {
      this._hass.callService("mass_queue", "play_queue_item", {
        entity: speaker,
        queue_item_id: track.queue_item_id
      });
      return;
    }

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
