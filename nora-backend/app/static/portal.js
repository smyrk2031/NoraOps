(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  /* ---- Help tabs (AJAX) ---- */
  if (window.NORAOPS_HELP) {
    const cfg = window.NORAOPS_HELP;
    const body = $("help-body");
    const base = cfg.contentBase || "/api/help/content";

    async function loadTab(tabId) {
      if (!body) return;
      body.innerHTML = "<p style='color:#94a3b8'>読み込み中…</p>";
      try {
        const res = await fetch(base + "/" + encodeURIComponent(tabId));
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        body.innerHTML = data.html || "<p>空のドキュメント</p>";
        document.querySelectorAll(".help-tab").forEach((el) => {
          el.classList.toggle("active", el.dataset.tabId === tabId);
        });
        history.replaceState(null, "", "?t=" + tabId);
      } catch (e) {
        body.innerHTML =
          "<p style='color:#ef4444'>読み込みに失敗しました: " +
          String(e.message) +
          "</p>";
      }
    }

    document.querySelectorAll(".help-tab[data-tab-id]").forEach((a) => {
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        loadTab(a.dataset.tabId);
      });
    });
    loadTab(cfg.activeTab || "overview");
  }

  /* ---- Ops center API button ---- */
  const opsApiBtn = $("ops-run-api");
  if (opsApiBtn && window.NORAOPS_OPS_API) {
    opsApiBtn.addEventListener("click", async () => {
      opsApiBtn.disabled = true;
      opsApiBtn.textContent = "実行中…";
      try {
        const res = await fetch(window.NORAOPS_OPS_API, { method: "POST" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        window.location.href = window.location.pathname.replace(/\/?$/, "") + "/run";
      } catch (e) {
        alert("失敗: " + e.message);
      } finally {
        opsApiBtn.disabled = false;
        opsApiBtn.textContent = "API で実行（JSON）";
      }
    });
  }

  /* ---- Admin charts ---- */
  const dashEl = $("dashboard-json");
  if (dashEl && typeof Chart !== "undefined") {
    let dash;
    try {
      dash = JSON.parse(dashEl.textContent);
    } catch (_) {
      return;
    }

    const chartDefaults = {
      responsive: true,
      plugins: { legend: { labels: { color: "#94a3b8" } } },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(51,65,85,0.5)" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(51,65,85,0.5)" } },
      },
    };

    function lineChart(canvasId, rows, labelKey, valueKey, label) {
      const el = $(canvasId);
      if (!el || !rows || !rows.length) return;
      new Chart(el, {
        type: "line",
        data: {
          labels: rows.map((r) => r[labelKey]),
          datasets: [
            {
              label: label,
              data: rows.map((r) => r[valueKey]),
              borderColor: "#6366f1",
              backgroundColor: "rgba(99,102,241,0.15)",
              fill: true,
              tension: 0.3,
            },
          ],
        },
        options: chartDefaults,
      });
    }

    function barChart(canvasId, rows, labelKey, valueKey, label) {
      const el = $(canvasId);
      if (!el || !rows || !rows.length) return;
      new Chart(el, {
        type: "bar",
        data: {
          labels: rows.map((r) => r[labelKey]),
          datasets: [
            {
              label: label,
              data: rows.map((r) => r[valueKey]),
              backgroundColor: "rgba(34,211,238,0.5)",
            },
          ],
        },
        options: { ...chartDefaults, indexAxis: rows.length > 8 ? "y" : "x" },
      });
    }

    lineChart("chart-dl-day", dash.downloads.byDay, "date", "count", "DL");
    lineChart("chart-runner-day", dash.runner.byDay, "date", "count", "Runner");
    const aiDays = (dash.aiUsage.days || []).map((d) => ({
      date: d.date,
      count: d.tokens_total || (d.tokens_in || 0) + (d.tokens_out || 0),
    }));
    lineChart("chart-ai-day", aiDays, "date", "count", "トークン");
    const aiJpy = (dash.aiUsage.days || []).map((d) => ({
      date: d.date,
      count: d.cost_jpy || 0,
    }));
    if ($("chart-ai-jpy-admin")) {
      lineChart("chart-ai-jpy-admin", aiJpy, "date", "count", "円");
    }
    barChart(
      "chart-telemetry-type",
      dash.telemetry.byType,
      "type",
      "count",
      "イベント"
    );

    /* AI usage page charts */
    const aiUsageEl = $("ai-usage-json");
    if (aiUsageEl && typeof Chart !== "undefined") {
      let aiSummary;
      try {
        aiSummary = JSON.parse(aiUsageEl.textContent);
      } catch (_) {
        aiSummary = null;
      }
      if (aiSummary && aiSummary.days && aiSummary.days.length) {
        const labels = aiSummary.days.map((r) => r.date);
        const tin = aiSummary.days.map((r) => r.tokens_in);
        const tout = aiSummary.days.map((r) => r.tokens_out);
        const jpy = aiSummary.days.map((r) => r.cost_jpy);
        const tokEl = $("chart-ai-tokens");
        if (tokEl) {
          new Chart(tokEl, {
            type: "bar",
            data: {
              labels,
              datasets: [
                { label: "入力", data: tin, backgroundColor: "rgba(99,102,241,0.7)" },
                { label: "出力", data: tout, backgroundColor: "rgba(34,211,238,0.6)" },
              ],
            },
            options: {
              responsive: true,
              scales: {
                x: { stacked: true, ticks: { color: "#94a3b8" } },
                y: { stacked: true, ticks: { color: "#94a3b8" } },
              },
            },
          });
        }
        const jpyEl = $("chart-ai-jpy");
        if (jpyEl) {
          new Chart(jpyEl, {
            type: "line",
            data: {
              labels,
              datasets: [
                {
                  label: "円（推定）",
                  data: jpy,
                  borderColor: "#f59e0b",
                  backgroundColor: "rgba(245,158,11,0.15)",
                  fill: true,
                  tension: 0.3,
                },
              ],
            },
            options: {
              responsive: true,
              scales: {
                x: { ticks: { color: "#94a3b8" } },
                y: { ticks: { color: "#94a3b8" } },
              },
            },
          });
        }
      }
    }

    const recoBtn = $("reco-search");
    const recoInput = $("reco-query");
    const recoOut = $("reco-results");
    if (recoBtn && recoOut && window.NORAOPS_ADMIN) {
      recoBtn.addEventListener("click", async () => {
        const q = (recoInput && recoInput.value) || "";
        recoOut.innerHTML = "<p style='color:#94a3b8'>検索中…</p>";
        try {
          const url =
            window.NORAOPS_ADMIN.recoUrl +
            "?q=" +
            encodeURIComponent(q);
          const res = await fetch(url);
          const data = await res.json();
          if (!data.items || !data.items.length) {
            recoOut.innerHTML = "<p>候補がありません。</p>";
            return;
          }
          let html = "<table class='data-table'><tr><th>リポジトリ</th><th>説明</th><th>★</th></tr>";
          data.items.forEach((it) => {
            html +=
              "<tr><td>" +
              (it.full_name || "") +
              "</td><td>" +
              (it.description || "—") +
              "</td><td>" +
              (it.stars ?? "—") +
              "</td></tr>";
          });
          html += "</table>";
          recoOut.innerHTML = html;
        } catch (e) {
          recoOut.innerHTML =
            "<p style='color:#ef4444'>エラー: " + e.message + "</p>";
        }
      });
    }
  }

  /* ---- CMS modal navigation ---- */
  document.querySelectorAll("[data-cms-modal]").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-cms-modal");
      const modal = $(id);
      if (modal) {
        modal.classList.add("open");
        modal.setAttribute("aria-hidden", "false");
      }
    });
  });
  document.querySelectorAll(".cms-modal-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const backdrop = btn.closest(".cms-modal-backdrop");
      if (backdrop) {
        backdrop.classList.remove("open");
        backdrop.setAttribute("aria-hidden", "true");
      }
    });
  });
  document.querySelectorAll(".cms-modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) {
        backdrop.classList.remove("open");
        backdrop.setAttribute("aria-hidden", "true");
      }
    });
  });

  /* ---- CMS checks toggles ---- */
  async function initChecksPanel() {
    const secList = $("checks-security-list");
    const polList = $("checks-policy-list");
    const triggerList = $("checks-trigger-list");
    if (!secList || !window.NORAOPS_CHECKS_API) return;
    try {
      const res = await fetch(window.NORAOPS_CHECKS_API);
      if (!res.ok) throw new Error("checks load failed");
      const data = await res.json();
      if (triggerList && data.extension_triggers) {
        triggerList.innerHTML = data.extension_triggers.map((t) => "<li>" + escapeHtml(t) + "</li>").join("");
      }
      renderCheckList(secList, (data.checks || []).filter((c) => c.category === "security"));
      renderCheckList(polList, (data.checks || []).filter((c) => c.category === "policy"));
    } catch (e) {
      secList.innerHTML = "<p style='color:var(--warn)'>読み込み失敗: " + e.message + "</p>";
      if (polList) polList.innerHTML = "";
    }
  }

  function renderCheckList(host, checks) {
    if (!host) return;
    if (!checks.length) {
      host.innerHTML = "<p style='color:var(--muted)'>（なし）</p>";
      return;
    }
    host.innerHTML = "";
    for (const c of checks) {
      const row = document.createElement("div");
      row.className = "check-row";
      const offBadge = c.enabled ? "" : "<span class='check-badge off'>OFF</span>";
      const deployBadge = c.deployed ? "" : "<span class='check-badge off'>未デプロイ</span>";
      const reqBadge = c.required ? "<span class='check-badge req'>必須</span>" : "";
      const specBlock = c.rule_spec
        ? "<div class='check-spec'>" + escapeHtml(c.rule_spec) + "</div>"
        : "";
      const toggleDisabled = !c.deployed || c.required;
      const toggleTitle = c.required ? "NoraOps 必須 — OFF にできません" : "有効/無効";
      row.innerHTML =
        "<div class='check-meta'>" +
        "<h4>" + escapeHtml(c.title) + reqBadge + offBadge + deployBadge + "</h4>" +
        "<div class='check-id'>" + escapeHtml(c.id) + "</div>" +
        "<p>" + escapeHtml(c.description) + "</p>" +
        specBlock +
        (c.auto_fix ? "<p style='margin-top:4px;font-size:0.78rem'>自動修正: <code>" + escapeHtml(c.auto_fix) + "</code></p>" : "") +
        "</div>" +
        "<label class='toggle' title='" + escapeHtml(toggleTitle) + "'>" +
        "<input type='checkbox' data-rule-id='" + escapeHtml(c.id) + "'" +
        (c.enabled ? " checked" : "") +
        (toggleDisabled ? " disabled" : "") +
        " />" +
        "<span class='toggle-slider'></span></label>";
      host.appendChild(row);
    }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const btnSaveChecks = $("btn-save-checks");
  if (btnSaveChecks && window.NORAOPS_CHECKS_API) {
    btnSaveChecks.addEventListener("click", async () => {
      const msg = $("checks-msg");
      const toggles = {};
      document.querySelectorAll("[data-rule-id]").forEach((el) => {
        toggles[el.getAttribute("data-rule-id")] = el.checked;
      });
      try {
        const res = await fetch(window.NORAOPS_CHECKS_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toggles }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "save failed");
        }
        const data = await res.json();
        if (msg) {
          msg.style.display = "block";
          msg.textContent = data.message || "保存しました。";
        }
      } catch (e) {
        alert("保存失敗: " + e.message);
      }
    });
    initChecksPanel();
  }

  async function initMcpReference() {
    const host = $("mcp-reference-list");
    if (!host || !window.NORAOPS_MCP_REFERENCE) return;
    try {
      const res = await fetch(window.NORAOPS_MCP_REFERENCE);
      if (!res.ok) throw new Error("mcp load failed");
      const data = await res.json();
      if (!data.sources || !data.sources.length) {
        host.innerHTML = "<p style='color:var(--muted)'>定義がありません。</p>";
        return;
      }
      host.innerHTML = "";
      for (const s of data.sources) {
        const card = document.createElement("div");
        card.className = "mcp-card";
        const when = (s.when || []).join(", ");
        card.innerHTML =
          "<h4>" + escapeHtml(s.title) + " <span class='check-id'>" + escapeHtml(s.id) + "</span></h4>" +
          (s.summary ? "<p>" + escapeHtml(s.summary) + "</p>" : "") +
          (when ? "<p style='margin-top:4px;font-size:0.78rem'>when: " + escapeHtml(when) + "</p>" : "");
        host.appendChild(card);
      }
      if (data.runtimeConnected === false) {
        const note = document.createElement("p");
        note.style.cssText = "color:var(--muted);font-size:0.82rem;margin-top:8px";
        note.textContent = "※ ランタイム未接続 — 拡張はこの定義をまだ参照していません。";
        host.appendChild(note);
      }
    } catch (e) {
      host.innerHTML = "<p style='color:var(--warn)'>読み込み失敗</p>";
    }
  }
  initMcpReference();

  /* ---- CMS prompts save (per modal) ---- */
  async function saveCmsPrompt(kind) {
    const body = {};
    if (kind === "concierge") {
      body.concierge_prompt_markdown = $("concierge_prompt_markdown")?.value;
    } else if (kind === "env") {
      body.env_prompt_markdown = $("env_prompt_markdown")?.value;
    }
    const res = await fetch(window.NORAOPS_CMS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "save failed");
    }
    return res.json();
  }

  document.querySelectorAll("[data-save-prompt]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.getAttribute("data-save-prompt");
      const msg = $(kind === "env" ? "cms-msg-env" : "cms-msg-concierge");
      try {
        const data = await saveCmsPrompt(kind);
        if (msg) {
          msg.style.display = "block";
          msg.textContent = data.message || "保存しました。";
        }
      } catch (e) {
        alert("保存失敗: " + e.message);
      }
    });
  });

  /* ---- CMS AI settings toggles ---- */
  function updateAiStatusDisplay(st) {
    if (!st) return;
    const set = (id, text) => {
      const el = $(id);
      if (el) el.textContent = text;
    };
    set("ai-st-enabled", st.enabled ? "ON" : "OFF");
    set("ai-st-copilot", st.features?.copilot ? "ON" : "OFF");
    set("ai-st-continue", st.features?.continue ? "ON" : "OFF");
    const tok = (st.usageToday?.tokens_in || 0) + (st.usageToday?.tokens_out || 0);
    set("ai-st-tokens", String(tok));
    const az = $("ai-st-azure");
    if (az) {
      az.textContent = st.configured ? "OK" : "未設定（.env）";
      az.style.color = st.configured ? "var(--ok)" : "var(--warn)";
    }
  }

  const btnSaveAi = $("btn-save-ai-settings");
  if (btnSaveAi && window.NORAOPS_AI_SETTINGS_API) {
    btnSaveAi.addEventListener("click", async () => {
      const msg = $("ai-settings-msg");
      const body = {
        ai_enabled: !!$("ai-toggle-master")?.checked,
        copilot_enabled: !!$("ai-toggle-copilot")?.checked,
        continue_enabled: !!$("ai-toggle-continue")?.checked,
      };
      try {
        const res = await fetch(window.NORAOPS_AI_SETTINGS_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "save failed");
        }
        const data = await res.json();
        updateAiStatusDisplay(data.status);
        if (msg) {
          msg.style.display = "block";
          msg.textContent = data.message || "保存しました。";
        }
      } catch (e) {
        alert("保存失敗: " + e.message);
      }
    });
  }

  /* ---- AI usage events filter ---- */
  const aiFilterBtn = $("ai-filter-apply");
  if (aiFilterBtn && window.NORAOPS_AI_EVENTS_API) {
    aiFilterBtn.addEventListener("click", async () => {
      const source = $("ai-filter-source")?.value || "";
      const dateFrom = $("ai-filter-from")?.value || "";
      const dateTo = $("ai-filter-to")?.value || "";
      const params = new URLSearchParams({ limit: "200" });
      if (source) params.set("source", source);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const tbody = $("ai-events-body");
      const meta = $("ai-events-meta");
      if (tbody) tbody.innerHTML = "<tr><td colspan='5'>読み込み中…</td></tr>";
      try {
        const res = await fetch(window.NORAOPS_AI_EVENTS_API + "?" + params.toString());
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (!data.events || !data.events.length) {
          if (tbody) tbody.innerHTML = "<tr><td colspan='5'>該当なし</td></tr>";
        } else if (tbody) {
          tbody.innerHTML = data.events
            .map(
              (ev) =>
                "<tr><td>" +
                escapeHtml(ev.ts) +
                "</td><td><code>" +
                escapeHtml(ev.source) +
                "</code></td><td>" +
                ev.tokens_in +
                "</td><td>" +
                ev.tokens_out +
                "</td><td>" +
                ev.tokens_total +
                "</td></tr>"
            )
            .join("");
        }
        if (meta) {
          meta.textContent =
            "表示 " + (data.events?.length || 0) + " 件 / 一致 " + (data.totalMatched || 0);
        }
      } catch (e) {
        if (tbody) tbody.innerHTML = "<tr><td colspan='5'>エラー: " + escapeHtml(e.message) + "</td></tr>";
      }
    });
  }

  /* ---- System dashboard charts ---- */
  const sysJsonEl = $("system-json");
  const btnSysRefresh = $("btn-sys-refresh");
  if (btnSysRefresh) {
    btnSysRefresh.addEventListener("click", () => location.reload());
  }
  if (sysJsonEl && typeof Chart !== "undefined") {
    let sysReport;
    try {
      sysReport = JSON.parse(sysJsonEl.textContent);
    } catch (_) {
      sysReport = null;
    }
    if (sysReport) {
      const cats = sysReport.categories || [];
      if (cats.length && $("chart-sys-storage")) {
        new Chart($("chart-sys-storage"), {
          type: "doughnut",
          data: {
            labels: cats.map((c) => c.label),
            datasets: [
              {
                data: cats.map((c) => c.bytes),
                backgroundColor: [
                  "rgba(99,102,241,0.75)",
                  "rgba(34,211,238,0.65)",
                  "rgba(34,197,94,0.6)",
                  "rgba(245,158,11,0.65)",
                  "rgba(168,85,247,0.6)",
                  "rgba(236,72,153,0.55)",
                  "rgba(148,163,184,0.5)",
                ],
              },
            ],
          },
          options: {
            responsive: true,
            plugins: { legend: { position: "bottom", labels: { color: "#94a3b8", boxWidth: 12 } } },
          },
        });
      }
      const giteaTop = (sysReport.gitea && sysReport.gitea.top_repos) || [];
      if (giteaTop.length && $("chart-sys-gitea")) {
        const top = giteaTop.slice(0, 10);
        new Chart($("chart-sys-gitea"), {
          type: "bar",
          data: {
            labels: top.map((r) => r.full_name),
            datasets: [
              {
                label: "KB (Gitea)",
                data: top.map((r) => r.size_kb),
                backgroundColor: "rgba(34,211,238,0.55)",
              },
            ],
          },
          options: {
            indexAxis: "y",
            responsive: true,
            scales: {
              x: { ticks: { color: "#94a3b8" } },
              y: { ticks: { color: "#94a3b8", font: { size: 10 } } },
            },
          },
        });
      }
    }
  }

  /* ---- Admin backup page ---- */
  if (window.NORAOPS_BACKUP) {
    const bk = window.NORAOPS_BACKUP;
    let restoreId = "";
    let extractId = "";

    function closeModals() {
      document.querySelectorAll(".modal-backdrop").forEach((el) => el.classList.remove("open"));
    }
    document.querySelectorAll(".modal-close").forEach((btn) => {
      btn.addEventListener("click", closeModals);
    });

    const runBtn = $("btn-backup-run");
    if (runBtn) {
      runBtn.addEventListener("click", async () => {
        runBtn.disabled = true;
        runBtn.textContent = "実行中…";
        try {
          const res = await fetch(bk.runUrl, { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "HTTP " + res.status);
          alert(data.message || "バックアップ完了");
          window.location.reload();
        } catch (e) {
          alert("失敗: " + e.message);
        } finally {
          runBtn.disabled = false;
          runBtn.textContent = "今すぐバックアップ";
        }
      });
    }

    const refreshBtn = $("btn-backup-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => window.location.reload());
    }

    const settingsForm = $("form-backup-settings");
    if (settingsForm) {
      settingsForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(settingsForm);
        const payload = {
          enabled: !!fd.get("enabled"),
          interval_hours: Number(fd.get("interval_hours") || 24),
          retention: Number(fd.get("retention") || 3),
          local_dir: String(fd.get("local_dir") || ""),
          remote_dir: String(fd.get("remote_dir") || ""),
          include_artifacts: !!fd.get("include_artifacts"),
          include_tools: !!fd.get("include_tools"),
        };
        try {
          const res = await fetch(bk.settingsUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "HTTP " + res.status);
          alert(data.message || "保存しました");
        } catch (e) {
          alert("失敗: " + e.message);
        }
      });
    }

    document.querySelectorAll(".btn-restore").forEach((btn) => {
      btn.addEventListener("click", () => {
        restoreId = btn.dataset.id || "";
        const el = $("restore-target-id");
        if (el) el.textContent = restoreId;
        const inp = $("restore-confirm");
        if (inp) inp.value = "";
        $("modal-restore")?.classList.add("open");
      });
    });

    document.querySelectorAll(".btn-extract").forEach((btn) => {
      btn.addEventListener("click", () => {
        extractId = btn.dataset.id || "";
        const el = $("extract-target-id");
        if (el) el.textContent = extractId;
        const inp = $("extract-confirm");
        if (inp) inp.value = "";
        document.querySelectorAll("#extract-components input").forEach((cb) => {
          cb.checked = false;
        });
        $("modal-extract")?.classList.add("open");
      });
    });

    const restoreGo = $("btn-restore-go");
    if (restoreGo) {
      restoreGo.addEventListener("click", async () => {
        const confirm = ($("restore-confirm")?.value || "").trim();
        if (confirm !== "RESTORE") {
          alert('確認のため "RESTORE" と入力してください');
          return;
        }
        restoreGo.disabled = true;
        try {
          const res = await fetch(bk.restoreUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ backup_id: restoreId, confirm: "RESTORE" }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "HTTP " + res.status);
          alert((data.message || "切り戻し完了") + (data.pre_restore_backup_id ? "\npre-restore: " + data.pre_restore_backup_id : ""));
          window.location.reload();
        } catch (e) {
          alert("失敗: " + e.message);
        } finally {
          restoreGo.disabled = false;
        }
      });
    }

    const extractGo = $("btn-extract-go");
    if (extractGo) {
      extractGo.addEventListener("click", async () => {
        const confirm = ($("extract-confirm")?.value || "").trim();
        if (confirm !== "EXTRACT") {
          alert('確認のため "EXTRACT" と入力してください');
          return;
        }
        const components = [];
        document.querySelectorAll("#extract-components input:checked").forEach((cb) => {
          components.push(cb.value);
        });
        if (!components.length) {
          alert("復元するコンポーネントを選択してください");
          return;
        }
        extractGo.disabled = true;
        try {
          const res = await fetch(bk.extractUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ backup_id: extractId, confirm: "EXTRACT", components }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "HTTP " + res.status);
          alert(data.message || "部分復元完了");
          window.location.reload();
        } catch (e) {
          alert("失敗: " + e.message);
        } finally {
          extractGo.disabled = false;
        }
      });
    }
  }
})();
