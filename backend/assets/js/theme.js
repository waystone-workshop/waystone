const systemTheme = () => matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
const setTheme = (theme) => {
  if (theme === "system") localStorage.removeItem("phx:theme")
  else localStorage.setItem("phx:theme", theme)
  document.documentElement.dataset.theme = theme === "system" ? systemTheme() : theme
  document.documentElement.dataset.themeSource = theme === "system" ? "system" : "user"
}
setTheme(localStorage.getItem("phx:theme") || "system")
window.addEventListener("storage", event => { if (event.key === "phx:theme") setTheme(event.newValue || "system") })
window.addEventListener("phx:set-theme", event => setTheme(event.target.dataset.phxTheme))
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", event => {
  if (document.documentElement.dataset.themeSource === "system")
    document.documentElement.dataset.theme = event.matches ? "dark" : "light"
})
