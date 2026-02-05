
(() => {
  const $ = s => document.querySelector(s);

  const META_KEY = "file_organizer_meta_v1";
  // session-only: actual File objects
  const fileStore = new Map(); // id -> File
  // persistent: metadata
  let meta = loadMeta();       // id -> {name, folder, tags, createdAt, size, type}
  let order = loadOrder();     // array of ids, persistent-ish for stable listing

  let selectedId = null;

  // UI
  const drop = $("#drop");
  const picker = $("#picker");
  const metaFile = $("#metaFile");
  const list = $("#list");
  const stats = $("#stats");
  const searchEl = $("#search");
  const folderEl = $("#folder");
  const sortEl = $("#sort");
  const previewEl = $("#preview");
  const toast = $("#toast");

  function showToast(msg){
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=>toast.classList.remove("show"), 900);
  }

  function loadMeta(){
    try{
      const raw = localStorage.getItem(META_KEY);
      const parsed = raw ? JSON.parse(raw) : {meta:{}, order:[]};
      return parsed.meta || {};
    }catch{
      return {};
    }
  }
  function loadOrder(){
    try{
      const raw = localStorage.getItem(META_KEY);
      const parsed = raw ? JSON.parse(raw) : {meta:{}, order:[]};
      return Array.isArray(parsed.order) ? parsed.order : [];
    }catch{
      return [];
    }
  }
  function saveAll(){
    localStorage.setItem(META_KEY, JSON.stringify({meta, order}));
  }

  function escapeHtml(s){
    return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function fmtSize(bytes){
    const u=["B","KB","MB","GB"];
    let i=0, n=bytes;
    while(n>=1024 && i<u.length-1){ n/=1024; i++; }
    return `${n.toFixed(i?1:0)} ${u[i]}`;
  }
  function formatDate(iso){
    const d = new Date(iso);
    return d.toLocaleString(undefined,{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  }
  function inferFolder(file){
    const t = (file.type || "").toLowerCase();
    const name = file.name.toLowerCase();
    const ext = name.includes(".") ? name.split(".").pop() : "";

    const codeExt = new Set(["js","ts","jsx","tsx","py","java","c","cpp","h","cs","go","rs","php","rb","html","css","scss","json","xml","yml","yaml","md","sql"]);
    const docExt  = new Set(["pdf","doc","docx","ppt","pptx","xls","xlsx","txt","rtf"]);
    const arcExt  = new Set(["zip","rar","7z","tar","gz"]);

    if(t.startsWith("image/")) return "Images";
    if(t.startsWith("audio/")) return "Audio";
    if(t.startsWith("video/")) return "Video";
    if(codeExt.has(ext)) return "Code";
    if(docExt.has(ext)) return "Documents";
    if(arcExt.has(ext)) return "Archives";
    return "Other";
  }

  function normalizeTags(tagStr){
    return tagStr
      .split(",")
      .map(t=>t.trim())
      .filter(Boolean)
      .map(t=>t.replace(/\s+/g," "))
      .map(t=>t.toLowerCase());
  }

  function addFiles(fileList){
    const files = [...fileList];
    if(!files.length) return;

    for(const f of files){
      const id = crypto.randomUUID();
      fileStore.set(id, f);

      meta[id] = {
        name: f.name,
        folder: inferFolder(f),
        tags: [],
        createdAt: new Date().toISOString(),
        size: f.size || 0,
        type: f.type || ""
      };
      order.unshift(id);
    }
    saveAll();
    render();
    showToast(`Added ${files.length} file(s)`);
  }

  function getView(){
    const q = searchEl.value.trim().toLowerCase();
    const folder = folderEl.value;
    const sort = sortEl.value;

    let ids = order.filter(id => meta[id]); // only existing

    if(folder !== "all"){
      ids = ids.filter(id => (meta[id].folder || "Other") === folder);
    }

    if(q){
      ids = ids.filter(id => {
        const m = meta[id];
        const inName = (m.name||"").toLowerCase().includes(q);
        const inTags = (m.tags||[]).some(t => t.includes(q));
        return inName || inTags;
      });
    }

    const byCreated = (a,b) => (meta[b].createdAt||"").localeCompare(meta[a].createdAt||"");
    const byCreatedAsc = (a,b) => (meta[a].createdAt||"").localeCompare(meta[b].createdAt||"");
    const byAZ = (a,b) => (meta[a].name||"").localeCompare(meta[b].name||"");
    const bySize = (a,b) => (meta[b].size||0) - (meta[a].size||0);

    if(sort==="new") ids.sort(byCreated);
    if(sort==="old") ids.sort(byCreatedAsc);
    if(sort==="az")  ids.sort(byAZ);
    if(sort==="size")ids.sort(bySize);

    return ids;
  }

  function render(){
    const ids = getView();
    const total = Object.keys(meta).length;
    stats.textContent = `${total} files • in memory ${fileStore.size}`;

    list.innerHTML = "";
    if(ids.length === 0){
      const el = document.createElement("div");
      el.className="item";
      el.innerHTML = `
        <div class="meta">No files found.</div>
        <div class="muted" style="margin-top:8px">Drop some files to organize them.</div>
      `;
      list.appendChild(el);
      if(!selectedId) renderPreview(null);
      return;
    }

    for(const id of ids){
      const m = meta[id];
      const tags = (m.tags||[]).slice(0,6).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join(" ");
      const el = document.createElement("div");
      el.className="item";
      el.innerHTML = `
        <div class="topline">
          <div>
            <div class="name">${escapeHtml(m.name || "Untitled")}</div>
            <div class="meta">
              <span class="badge folder">${escapeHtml(m.folder || "Other")}</span>
              <span class="badge">${escapeHtml(fmtSize(m.size||0))}</span>
              <span class="badge">${escapeHtml((m.type || "unknown").slice(0,24))}</span>
              <span class="badge">${escapeHtml(formatDate(m.createdAt||new Date().toISOString()))}</span>
            </div>
          </div>
          <div class="actions">
            <button class="primary" data-act="select">Select</button>
            <button data-act="download">Download</button>
            <button class="danger" data-act="del">Delete</button>
          </div>
        </div>
        <div class="badges" style="margin-top:10px">
          ${tags || `<span class="muted">No tags</span>`}
        </div>
      `;

      el.querySelector('[data-act="select"]').onclick = () => {
        selectedId = id;
        renderPreview(id);
      };

      el.querySelector('[data-act="download"]').onclick = () => downloadFile(id);

      el.querySelector('[data-act="del"]').onclick = () => {
        if(confirm("Remove this file from organizer?")){
          delete meta[id];
          order = order.filter(x => x !== id);
          fileStore.delete(id);
          if(selectedId === id) selectedId = null;
          saveAll(); render();
          showToast("Deleted");
        }
      };

      list.appendChild(el);
    }

    // Keep preview in sync
    if(selectedId && !meta[selectedId]) selectedId = null;
    renderPreview(selectedId);
  }

  function renderPreview(id){
    if(!id){
      previewEl.innerHTML = `<div class="muted">Click a file from the list to preview & edit.</div>`;
      return;
    }
    const m = meta[id];
    const f = fileStore.get(id); // may be undefined if reloaded tab

    const tagsStr = (m.tags||[]).join(", ");
    const canPreviewText = f && (m.type.startsWith("text/") || /\.(txt|md|json|csv|html|css|js|ts|xml|yml|yaml)$/i.test(m.name));
    const canPreviewImage = f && m.type.startsWith("image/");

    previewEl.innerHTML = `
      <div class="topline" style="margin-bottom:8px">
        <div class="badges">
          <span class="badge folder">${escapeHtml(m.folder||"Other")}</span>
          <span class="badge">${escapeHtml(fmtSize(m.size||0))}</span>
        </div>
        <div class="meta">${escapeHtml(formatDate(m.createdAt||new Date().toISOString()))}</div>
      </div>

      <div class="label">Rename</div>
      <input id="pName" value="${escapeHtml(m.name||"")}" />

      <div class="row" style="margin-top:10px">
        <div class="grow">
          <div class="label">Folder</div>
          <select id="pFolder">
            ${["Images","Documents","Audio","Video","Archives","Code","Other"].map(x =>
              `<option value="${x}" ${x===m.folder?"selected":""}>${x}</option>`
            ).join("")}
          </select>
        </div>
      </div>

      <div class="label">Tags (comma separated)</div>
      <input id="pTags" value="${escapeHtml(tagsStr)}" placeholder="e.g., uni, project, important" />

      <div class="row" style="margin-top:10px">
        <button class="primary grow" id="pSave">Save changes</button>
        <button id="pDownload">Download</button>
      </div>

      <div class="panelLine"></div>

      <div class="label">Preview</div>
      <div class="muted" id="pHint" style="margin-bottom:8px">
        ${f ? "Previewing file from this session." : "Preview unavailable after refresh — re-add the file to preview/download."}
      </div>

      <div id="pBody"></div>
    `;

    $("#pSave").onclick = () => {
      const newName = $("#pName").value.trim();
      if(!newName){ showToast("Name cannot be empty"); return; }
      m.name = newName;
      m.folder = $("#pFolder").value;
      m.tags = normalizeTags($("#pTags").value);
      saveAll(); render();
      showToast("Saved");
    };

    $("#pDownload").onclick = () => downloadFile(id);

    const body = $("#pBody");
    body.innerHTML = "";

    if(!f){
      body.innerHTML = `<div class="muted">No file bytes in memory (likely page refresh). Metadata is still saved.</div>`;
      return;
    }

    if(canPreviewImage){
      const url = URL.createObjectURL(f);
      body.innerHTML = `<img alt="preview" src="${url}">`;
      // cleanup when replaced next time
      setTimeout(()=>URL.revokeObjectURL(url), 15000);
      return;
    }

    if(canPreviewText){
      f.text().then(txt=>{
        const pre = document.createElement("pre");
        pre.textContent = txt.slice(0, 40000) + (txt.length>40000 ? "\n\n…(trimmed preview)…" : "");
        body.appendChild(pre);
      }).catch(()=>{
        body.innerHTML = `<div class="muted">Could not read file as text.</div>`;
      });
      return;
    }

    body.innerHTML = `<div class="muted">Preview not supported for this file type.</div>`;
  }

  function downloadFile(id){
    const m = meta[id];
    const f = fileStore.get(id);

    if(!f){
      alert("This file is not in memory (likely after a refresh). Please drop the file again to download it.");
      return;
    }

    // Create a new File with renamed filename (bytes unchanged)
    const renamed = new File([f], m.name, {type: f.type || "application/octet-stream"});

    const url = URL.createObjectURL(renamed);
    const a = document.createElement("a");
    a.href = url;
    a.download = m.name || f.name;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Downloading…");
  }

  // Export/Import metadata
  function exportMeta(){
    const data = JSON.stringify({version:1, exportedAt:new Date().toISOString(), meta, order}, null, 2);
    const blob = new Blob([data], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url;
    a.download="file-organizer-metadata.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported");
  }

  function importMetaFile(file){
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const parsed = JSON.parse(reader.result);
        const incomingMeta = parsed.meta || {};
        const incomingOrder = parsed.order || [];
        if(typeof incomingMeta !== "object") throw new Error("bad");

        // merge
        meta = {...meta, ...incomingMeta};
        // merge order: keep incoming first, then existing
        const seen = new Set();
        const merged = [];
        for(const id of (Array.isArray(incomingOrder)?incomingOrder:[])){
          if(id && meta[id] && !seen.has(id)){ merged.push(id); seen.add(id); }
        }
        for(const id of order){
          if(id && meta[id] && !seen.has(id)){ merged.push(id); seen.add(id); }
        }
        // also add any meta keys missing in order
        for(const id of Object.keys(meta)){
          if(!seen.has(id)){ merged.push(id); seen.add(id); }
        }
        order = merged;

        saveAll(); render();
        showToast("Imported");
      }catch(e){
        alert("Import failed: invalid metadata JSON.");
      }
    };
    reader.readAsText(file);
  }

  // Drag/drop
  function stop(e){ e.preventDefault(); e.stopPropagation(); }

  ["dragenter","dragover"].forEach(evt=>{
    drop.addEventListener(evt, e=>{
      stop(e);
      drop.classList.add("drag");
    });
  });
  ["dragleave","drop"].forEach(evt=>{
    drop.addEventListener(evt, e=>{
      stop(e);
      drop.classList.remove("drag");
    });
  });
  drop.addEventListener("drop", e=>{
    const dt = e.dataTransfer;
    if(dt && dt.files) addFiles(dt.files);
  });

  // Buttons
  $("#choose").onclick = () => picker.click();
  picker.onchange = () => {
    if(picker.files) addFiles(picker.files);
    picker.value="";
  };

  $("#clearAll").onclick = () => {
    if(!Object.keys(meta).length){ showToast("Nothing to clear"); return; }
    if(confirm("Clear ALL organized files and metadata?")){
      meta = {};
      order = [];
      fileStore.clear();
      selectedId = null;
      saveAll(); render();
      showToast("Cleared");
    }
  };

  $("#export").onclick = exportMeta;
  $("#import").onclick = () => metaFile.click();
  metaFile.onchange = () => {
    const f = metaFile.files && metaFile.files[0];
    if(f) importMetaFile(f);
    metaFile.value="";
  };

  [searchEl, folderEl, sortEl].forEach(el => el.addEventListener("input", render));
  [folderEl, sortEl].forEach(el => el.addEventListener("change", render));

  render();
})();
