import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT, 10) || 3000;

// DB must live in a writable, update-safe location — the install directory
// (and the asar archive) are read-only once packaged.
process.env.DB_PATH = path.join(app.getPath("userData"), "attendance.db");

let mainWindow = null;
let tray = null;
let isQuitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(startServerAndWindow);
}

async function startServerAndWindow() {
  const { app: expressApp } = await import("../app.js");

  const server = expressApp.listen(PORT, () => {
    createWindow();
    createTray();
  });

  server.on("error", err => {
    if (err.code === "EADDRINUSE") {
      dialog.showErrorBox(
        "RFID Attendance",
        `Port ${PORT} is already in use by another program. Close it and restart the app, or set the PORT environment variable to a free port.`
      );
    } else {
      dialog.showErrorBox("RFID Attendance", `Failed to start: ${err.message}`);
    }
    app.quit();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: "RFID Attendance",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}/`);

  mainWindow.on("close", event => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "build", "icon.png"));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("RFID Attendance");

  const menu = Menu.buildFromTemplate([
    {
      label: "Open Kiosk",
      click: () => {
        mainWindow.loadURL(`http://localhost:${PORT}/`);
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: "Open Admin Panel",
      click: () => {
        mainWindow.loadURL(`http://localhost:${PORT}/admin.html`);
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: menuItem => {
        app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);

  tray.on("click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

app.on("window-all-closed", () => {
  // The app lives in the tray; keep running until Quit is chosen.
});

app.on("before-quit", () => {
  isQuitting = true;
});
