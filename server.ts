import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";
import path from "path";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const PORT = 3000;

  app.use(express.json());

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // In-memory store for user sheet monitoring
  // Key: socketId
  const monitors = new Map<string, { spreadsheetIds: string[], lastPolledTimes: Map<string, string>, interval: NodeJS.Timeout }>();

  // Health check to verify configuration
  app.get("/api/health", (req, res) => {
    const gasUrl = process.env.GAS_URL;
    if (!gasUrl) {
       console.error("GAS_URL not configured in environment");
      return;
     }
    res.json({ 
      status: "ok", 
      gasConfigured: "TRUE",
      env: process.env.NODE_ENV
    });
  });

  // Get spreadsheet info (name)
  app.get("/api/spreadsheet/info", async (req, res) => {
    const { spreadsheetId } = req.query;
    const gasUrl = process.env.GAS_URL;

    if (!spreadsheetId || typeof spreadsheetId !== 'string' || !gasUrl) {
      return res.status(400).json({ error: "Missing spreadsheetId or GAS_URL not configured" });
    }

    try {
      const url = new URL(gasUrl);
      url.searchParams.append("mode", "info");
      url.searchParams.append("spreadsheetId", spreadsheetId);

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error("Failed to fetch from GAS");
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Start monitoring sheets via GAS
  app.post("/api/monitor/start", async (req, res) => {
    const { spreadsheetIds, frequency, startDate, socketId } = req.body;
    const gasUrl = process.env.GAS_URL;
    
    if (!spreadsheetIds || !Array.isArray(spreadsheetIds) || spreadsheetIds.length === 0 || !gasUrl || !socketId) {
      return res.status(400).json({ error: "Missing spreadsheetIds, socketId, or GAS_URL not configured on server" });
    }

    const pollFrequency = Math.max(1, frequency || 1) * 60 * 1000;
    const initialPolledTime = startDate || new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Clear existing monitor for this socket if any
    if (monitors.has(socketId)) {
      clearInterval(monitors.get(socketId)!.interval);
    }

    const lastPolledTimes = new Map<string, string>();
    spreadsheetIds.forEach(id => lastPolledTimes.set(id, initialPolledTime));

    const poll = async () => {
      const monitor = monitors.get(socketId);
      if (!monitor) return;

      try {
        const gasUrl = process.env.GAS_URL;
        if (!gasUrl) {
          console.error("GAS_URL not configured in environment");
          return;
        }

        const url = new URL(gasUrl);
        const ids = monitor.spreadsheetIds.join(',');
        const dates = monitor.spreadsheetIds.map(id => monitor.lastPolledTimes.get(id) || initialPolledTime).join(',');
        
        url.searchParams.append("spreadsheetIds", ids);
        url.searchParams.append("lastPolledDates", dates);

        console.log(`Polling GAS for multiple IDs: ${ids}`);
        const response = await fetch(url.toString());
        
        if (!response.ok) return;
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) return;
        
        const data = await response.json();
        const results = data.results || [];

        for (const result of results) {
          if (result.error) {
            console.error(`Error polling ${result.spreadsheetId}: ${result.error}`);
            continue;
          }

          if (result.count > 0) {
            io.to(socketId).emit("new-rows", { 
              spreadsheetId: result.spreadsheetId,
              spreadsheetName: result.spreadsheetName,
              count: result.count, 
              rows: result.rows,
              timestamp: result.currentTime || new Date().toISOString()
            });
          }
          
          monitor.lastPolledTimes.set(result.spreadsheetId, result.currentTime || new Date().toISOString());
        }
      } catch (err) {
        console.error(`Consolidated polling error:`, err);
      }
      io.to(socketId).emit("poll-complete");
    };

    const interval = setInterval(poll, pollFrequency);

    monitors.set(socketId, { 
      spreadsheetIds, 
      lastPolledTimes, 
      interval 
    });

    // Run first poll immediately
    poll();

    res.json({ success: true, nextPollIn: pollFrequency });
  });

  app.post("/api/monitor/stop", (req, res) => {
    const { socketId } = req.body;
    if (monitors.has(socketId)) {
      clearInterval(monitors.get(socketId)!.interval);
      monitors.delete(socketId);
    }
    res.json({ success: true });
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("request-manual-poll", async () => {
      const monitor = monitors.get(socket.id);
      if (!monitor) {
        socket.emit("monitor-error", { message: "No active monitor found." });
        return;
      }

      try {
        const gasUrl = process.env.GAS_URL;
        if (!gasUrl) {
          socket.emit("monitor-error", { message: "GAS_URL not configured on server." });
          return;
        }

        const url = new URL(gasUrl);
        const ids = monitor.spreadsheetIds.join(',');
        const dates = monitor.spreadsheetIds.map(id => monitor.lastPolledTimes.get(id) || new Date(Date.now() - 86400000).toISOString()).join(',');
        
        url.searchParams.append("spreadsheetIds", ids);
        url.searchParams.append("lastPolledDates", dates);

        const response = await fetch(url.toString());
        if (!response.ok) return;
        const data = await response.json();
        const results = data.results || [];

        for (const result of results) {
          if (result.error) continue;

          if (result.count > 0) {
            socket.emit("new-rows", { 
              spreadsheetId: result.spreadsheetId,
              spreadsheetName: result.spreadsheetName,
              count: result.count, 
              rows: result.rows,
              timestamp: result.currentTime || new Date().toISOString()
            });
          }
          
          monitor.lastPolledTimes.set(result.spreadsheetId, result.currentTime || new Date().toISOString());
        }
      } catch (err) {
        console.error(`Manual consolidated poll error:`, err);
      }
      socket.emit("poll-complete", { success: true });
    });

    socket.on("disconnect", () => {
      if (monitors.has(socket.id)) {
        clearInterval(monitors.get(socket.id)!.interval);
        monitors.delete(socket.id);
      }
    });
  });



  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
