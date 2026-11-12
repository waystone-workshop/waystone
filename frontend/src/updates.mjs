export function setupUpdates(bridge, document, report) {
  if (!bridge.updateStatus) return;
  const $ = (id) => document.getElementById(id);
  const show = (state) => {
    $("update-panel").hidden = ["idle", "disabled", "checking", "current"].includes(state.phase);
    $("update-current").textContent = `Waystone ${state.current}`;
    $("update-message").textContent = state.message;
    $("update-progress").hidden = state.phase !== "downloading";
    $("update-progress").value = state.percent || 0;
    $("update-download").hidden = state.phase !== "available";
    $("update-download").textContent = state.manual ? "Open release download" : "Download update";
    $("update-install").hidden = state.phase !== "downloaded";
  };
  bridge.onUpdate(show);
  bridge.updateStatus().then(show).catch(report);
  $("update-download").onclick = () => bridge.downloadUpdate().catch(report);
  $("update-install").onclick = () => bridge.installUpdate().catch(report);
  $("update-dismiss").onclick = () => { $("update-panel").hidden = true; };
}
