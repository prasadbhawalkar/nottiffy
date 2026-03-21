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
  const monitors = new Map<string, { spreadsheetId: string, gasUrl: string, lastPolledTime: string, interval: NodeJS.Timeout }>();

  // Start monitoring a sheet via GAS
  app.post("/api/monitor/start", async (req, res) => {
    const { spreadsheetId, gasUrl, frequency, startDate, socketId } = req.body;
    
    if (!spreadsheetId || !gasUrl) {
      return res.status(400).json({ error: "Missing spreadsheetId or gasUrl" });
    }

    const pollFrequency = Math.max(1, frequency || 1) * 60 * 1000; // Convert minutes to ms, min 1 min
    const initialPolledTime = startDate || new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Clear existing monitor for this socket if any
    if (monitors.has(socketId)) {
      clearInterval(monitors.get(socketId)!.interval);
    }

    const poll = async () => {
      const monitor = monitors.get(socketId);
      if (!monitor) return;

      try {
        const url = new URL(monitor.gasUrl);
        url.searchParams.append("spreadsheetId", monitor.spreadsheetId);
        url.searchParams.append("lastPolledDate", monitor.lastPolledTime);

        console.log(`Polling GAS: ${url.toString()}`);
        const response = await fetch(url.toString());
        
        const contentType = response.headers.get('content-type');
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`GAS returned ${response.status}: ${text.substring(0, 50)}`);
        }

        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          console.error('GAS returned non-JSON:', text);
          throw new Error("GAS script returned HTML instead of JSON. Ensure it is deployed as a Web App and shared with 'Anyone'.");
        }
        
        const data = await response.json();
        
        if (data.count > 0) {
          io.to(socketId).emit("new-rows", { 
            count: data.count, 
            rows: data.rows,
            timestamp: data.currentTime || new Date().toISOString()
          });
        }
        
        // Update last polled time to the time returned by GAS or current time
        monitor.lastPolledTime = data.currentTime || new Date().toISOString();
      } catch (err) {
        console.error("Polling error:", err);
        io.to(socketId).emit("monitor-error", { message: "Failed to poll GAS script. Check your URL and permissions." });
      }
    };

    const interval = setInterval(poll, pollFrequency);

    monitors.set(socketId, { 
      spreadsheetId, 
      gasUrl, 
      lastPolledTime: initialPolledTime, 
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
        socket.emit("monitor-error", { message: "No active monitor found for manual poll." });
        return;
      }

      try {
        const url = new URL(monitor.gasUrl);
        url.searchParams.append("spreadsheetId", monitor.spreadsheetId);
        url.searchParams.append("lastPolledDate", monitor.lastPolledTime);

        console.log(`Manual Polling GAS: ${url.toString()}`);
        const response = await fetch(url.toString());
        
        const contentType = response.headers.get('content-type');
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`GAS returned ${response.status}: ${text.substring(0, 50)}`);
        }

        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          console.error('GAS returned non-JSON:', text);
          throw new Error("GAS script returned HTML instead of JSON. Ensure it is deployed as a Web App and shared with 'Anyone'.");
        }
        
        const data = await response.json();
        
        if (data.count > 0) {
          socket.emit("new-rows", { 
            count: data.count, 
            rows: data.rows,
            timestamp: data.currentTime || new Date().toISOString()
          });
        }
        
        monitor.lastPolledTime = data.currentTime || new Date().toISOString();
        socket.emit("poll-complete", { success: true });
      } catch (err) {
        console.error("Manual polling error:", err);
        socket.emit("monitor-error", { message: "Manual poll failed. Check your GAS script." });
      }
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
