export function setupUpdates(bridge, document, report) {
  if (!bridge.updateStatus) return;
  const $ = (id) => document.getElementById(id);
  const show = (state) => {
    $("update-panel").hidden = ["idle", "disabled"].includes(state.phase);
    $("update-current").textContent = `Waystone ${state.current}`;
    $("update-message").textContent = state.message;
    $("update-progress").hidden = state.phase !== "downloading";
    $("update-progress").value = state.percent || 0;
    $("update-download").hidden = state.phase !== "available";
    $("update-download").textContent = state.manual ? "Open release download" : "Download update";
    $("update-install").hidden = state.phase !== "downloaded";
    for (const id of ["check-updates", "workspace-updates"])
      $(id).disabled = ["checking", "downloading"].includes(state.phase);
  };
  bridge.onUpdate(show);
  bridge.updateStatus().then(show).catch(report);
  const check = async () => {
    try {
      const state = await bridge.checkUpdate();
      show(state);
      if (state.phase === "disabled") {
        $("update-panel").hidden = false;
      }
    } catch (error) { report(error); }
  };
  $("check-updates").onclick = check;
  $("workspace-updates").onclick = check;
  $("update-download").onclick = () => bridge.downloadUpdate().catch(report);
  $("update-install").onclick = () => bridge.installUpdate().catch(report);
  $("update-dismiss").onclick = () => { $("update-panel").hidden = true; };
}
