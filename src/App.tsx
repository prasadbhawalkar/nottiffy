/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Bell, 
  Settings, 
  Table, 
  CheckCircle2, 
  AlertCircle, 
  Link as LinkIcon, 
  Palette, 
  Type,
  RefreshCw,
  PlusCircle,
  Clock,
  ExternalLink,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface RowUpdate {
  count: number;
  rows: any[][];
  timestamp: string;
}

export default function App() {
  const [gasUrl, setGasUrl] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('gasUrl');
    if (urlParam) return decodeURIComponent(urlParam);
    return localStorage.getItem('gas_url') || '';
  });
  const [spreadsheetId, setSpreadsheetId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get('spreadsheetId');
    if (idParam) return idParam;
    return localStorage.getItem('spreadsheet_id') || '';
  });
  const [frequency, setFrequency] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const freqParam = params.get('frequency');
    if (freqParam) return Number(freqParam);
    return Number(localStorage.getItem('poll_frequency')) || 5;
  });
  const [startDate, setStartDate] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('startDate');
    if (dateParam) return dateParam;
    // Default to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  });

  const isPreConfigured = new URLSearchParams(window.location.search).has('gasUrl') && 
                          new URLSearchParams(window.location.search).has('spreadsheetId');

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [updates, setUpdates] = useState<RowUpdate[]>([]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'monitoring' | 'error'>('idle');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  
  // Personalization
  const [themeColor, setThemeColor] = useState(() => localStorage.getItem('theme_color') || '#10b981');
  const [appName, setAppName] = useState(() => localStorage.getItem('app_name') || 'Nottiffy');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('new-rows', (update: RowUpdate) => {
      setUpdates(prev => [update, ...prev]);
      if (Notification.permission === 'granted') {
        new Notification(`${update.count} New Row(s) Added!`, {
          body: `Detected in your spreadsheet at ${new Date(update.timestamp).toLocaleTimeString()}`,
        });
      }
    });

    newSocket.on('poll-complete', () => {
      setIsRefreshing(false);
    });

    newSocket.on('monitor-error', (err: { message: string }) => {
      setError(err.message);
      setStatus('error');
      setIsMonitoring(false);
      setIsRefreshing(false);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('spreadsheet_id', spreadsheetId);
    localStorage.setItem('gas_url', gasUrl);
    localStorage.setItem('poll_frequency', frequency.toString());
    localStorage.setItem('theme_color', themeColor);
    localStorage.setItem('app_name', appName);
  }, [spreadsheetId, gasUrl, frequency, themeColor, appName]);

  const startMonitoring = async () => {
    if (!spreadsheetId || !gasUrl) {
      setError('Please enter both Spreadsheet ID and GAS Web App URL');
      return;
    }

    setStatus('connecting');
    setError(null);

    try {
      const response = await fetch('/api/monitor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId,
          gasUrl,
          frequency,
          startDate,
          socketId: socket?.id
        })
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to start monitoring');
        } else {
          const text = await response.text();
          console.error('Non-JSON Error Response:', text);
          throw new Error(`Server Error (${response.status}): ${text.substring(0, 100)}...`);
        }
      }

      setIsMonitoring(true);
      setStatus('monitoring');
      
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  };

  const stopMonitoring = async () => {
    try {
      await fetch('/api/monitor/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socketId: socket?.id })
      });
      setIsMonitoring(false);
      setStatus('idle');
    } catch (err) {
      console.error('Stop error:', err);
    }
  };

  const handleManualPoll = () => {
    if (!isMonitoring) return;
    setIsRefreshing(true);
    socket?.emit('request-manual-poll');
  };

  const openSpreadsheet = () => {
    if (!spreadsheetId) return;
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    window.open(url, '_blank');
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 selection:bg-emerald-100 pb-12">
      {/* Mobile Header */}
      <header 
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-white/80 backdrop-blur-md border-b border-zinc-200"
        style={{ borderTop: `4px solid ${themeColor}` }}
      >
        <div className="flex items-center gap-3">
          <div 
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200/50"
            style={{ backgroundColor: themeColor }}
          >
            <Bell size={20} />
          </div>
          <h1 className="font-bold text-xl tracking-tight">{appName}</h1>
        </div>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 rounded-full hover:bg-zinc-100 transition-colors text-zinc-500"
        >
          <Settings size={20} />
        </button>
      </header>

      <main className="max-w-md mx-auto p-6 space-y-6">
        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-white rounded-2xl border border-zinc-200 shadow-sm"
            >
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-zinc-600">
                    <Type size={16} /> App Name
                  </label>
                  <input 
                    type="text" 
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                    placeholder="Enter app name..."
                  />
                </div>

                {!isPreConfigured && (
                  <>
                    <div className="space-y-4">
                      <label className="flex items-center gap-2 text-sm font-semibold text-zinc-600">
                        <LinkIcon size={16} /> Google App Script URL
                      </label>
                      <input 
                        type="text" 
                        value={gasUrl}
                        onChange={(e) => setGasUrl(e.target.value)}
                        disabled={isMonitoring}
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-400"
                        placeholder="https://script.google.com/macros/s/.../exec"
                      />
                    </div>

                    <div className="space-y-4">
                      <label className="flex items-center gap-2 text-sm font-semibold text-zinc-600">
                        <Table size={16} /> Spreadsheet ID
                      </label>
                      <input 
                        type="text" 
                        value={spreadsheetId}
                        onChange={(e) => setSpreadsheetId(e.target.value)}
                        disabled={isMonitoring}
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-400"
                        placeholder="Enter ID from URL..."
                      />
                    </div>
                  </>
                )}

                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-zinc-600">
                    <Clock size={16} /> Polling Frequency (minutes)
                  </label>
                  <input 
                    type="number" 
                    min="1"
                    value={frequency}
                    onChange={(e) => setFrequency(Number(e.target.value))}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-zinc-600">
                    <Clock size={16} /> Start Monitoring From
                  </label>
                  <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                  />
                  <p className="text-[10px] text-zinc-400">
                    Only rows added after this date will trigger notifications.
                  </p>
                </div>

                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-zinc-600">
                    <Palette size={16} /> Theme Color
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'].map(color => (
                      <button
                        key={color}
                        onClick={() => setThemeColor(color)}
                        className={cn(
                          "w-8 h-8 rounded-full border-2 transition-transform active:scale-90",
                          themeColor === color ? "border-zinc-900 scale-110" : "border-transparent"
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-4 pt-4 border-t border-zinc-100">
                  <label className="flex items-center gap-2 text-sm font-semibold text-zinc-600">
                    <LinkIcon size={16} /> Shareable Config
                  </label>
                  <p className="text-xs text-zinc-400">
                    Generate a link with your current settings to share or bookmark.
                  </p>
                  <button
                    onClick={() => {
                      const params = new URLSearchParams();
                      params.set('gasUrl', gasUrl);
                      params.set('spreadsheetId', spreadsheetId);
                      params.set('frequency', frequency.toString());
                      params.set('startDate', startDate);
                      const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
                      navigator.clipboard.writeText(shareUrl);
                      alert('Config link copied to clipboard!');
                    }}
                    className="w-full py-3 rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-sm font-bold"
                  >
                    <RefreshCw size={16} />
                    Copy Config Link
                  </button>
                </div>


              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Configuration Card */}
        <section className="bg-white rounded-3xl p-8 shadow-sm border border-zinc-100 space-y-6">
          <div className="space-y-2">
            <h2 className="text-lg font-bold">
              {isMonitoring ? 'Monitoring Active' : 'Ready to Monitor'}
            </h2>
            <p className="text-sm text-zinc-500">
              {isMonitoring 
                ? `Watching ${spreadsheetId.substring(0, 8)}...` 
                : isPreConfigured 
                  ? 'App is pre-configured and ready'
                  : 'Configure your script in settings to start'}
            </p>
          </div>

          <div className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 text-red-600 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              <button 
                onClick={isMonitoring ? stopMonitoring : startMonitoring}
                disabled={status === 'connecting'}
                className={cn(
                  "w-full py-4 rounded-2xl font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2",
                  isMonitoring 
                    ? "bg-red-50 text-red-600 hover:bg-red-100" 
                    : "text-white hover:opacity-90 shadow-lg shadow-emerald-200/50"
                )}
                style={!isMonitoring ? { backgroundColor: themeColor } : {}}
              >
                {status === 'connecting' ? (
                  <RefreshCw size={20} className="animate-spin" />
                ) : isMonitoring ? (
                  <>Stop Monitoring</>
                ) : (
                  <>Start Monitoring</>
                )}
              </button>

              {isMonitoring && (
                <button 
                  onClick={handleManualPoll}
                  disabled={isRefreshing}
                  className="w-full py-4 rounded-2xl font-bold bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Zap size={18} className={cn(isRefreshing && "animate-pulse text-yellow-500")} />
                  {isRefreshing ? 'Checking...' : 'Refresh Now'}
                </button>
              )}

              {spreadsheetId && (
                <button 
                  onClick={openSpreadsheet}
                  className="w-full py-4 rounded-2xl font-bold border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <ExternalLink size={18} />
                  Open Spreadsheet
                </button>
              )}
              
              {!isMonitoring && !isPreConfigured && !spreadsheetId && (
                <button 
                  onClick={() => setShowSettings(true)}
                  className="w-full py-4 rounded-2xl font-bold bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Settings size={18} />
                  Open Settings to Configure
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Status Indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          <div className={cn(
            "w-2 h-2 rounded-full",
            isMonitoring ? "bg-emerald-500 animate-pulse" : "bg-zinc-300"
          )} />
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
            {isMonitoring ? `Polling every ${frequency}m` : 'Monitoring Inactive'}
          </span>
        </div>

        {/* Updates Feed */}
        <section className="space-y-4">
          <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider px-2">Recent Updates</h3>
          
          <div className="space-y-3">
            {updates.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-zinc-200">
                <p className="text-zinc-400 text-sm italic">No updates yet. Waiting for new rows...</p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {updates.map((update) => (
                  <motion.div 
                    key={update.timestamp}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm flex items-start gap-4"
                  >
                    <div 
                      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${themeColor}15`, color: themeColor }}
                    >
                      <PlusCircle size={20} />
                    </div>
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-zinc-900">{update.count} New Row{update.count > 1 ? 's' : ''}</h4>
                        <span className="text-[10px] font-bold text-zinc-400 uppercase">
                          {new Date(update.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="text-sm text-zinc-500 overflow-hidden">
                        {update.rows.map((row, i) => (
                          <div key={i} className="truncate border-l-2 border-zinc-100 pl-2 mt-1 first:mt-0">
                            {row.join(', ')}
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </section>
      </main>

      {/* Footer Info */}
      <footer className="max-w-md mx-auto p-8 text-center">
        <p className="text-xs text-zinc-400 leading-relaxed">
          The app executes the Google app script which checks for spreadsheet updates at the specified frequency. 
          Ensure your GAS script is deployed as a Web App with access for "Anyone".
        </p>
      </footer>
    </div>
  );
}
