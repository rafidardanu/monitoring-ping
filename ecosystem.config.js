module.exports = {
  apps: [
    {
      name: "monitoring-ping",
      script: "cmd.exe",
      args: ["/c", "start-monitoring.bat"],
      cwd: "C:\\Users\\Danu\\Documents\\GitHub\\monitoring-ping",
      interpreter: "none",
      windowsHide: true
    }
  ]
};