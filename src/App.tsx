/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Bell, 
  Settings, 
  AlertCircle, 
  Palette, 
  Type,
  RefreshCw,
  PlusCircle,
  Clock,
  ExternalLink,
  Zap,
  Check,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface RowUpdate {
  spreadsheetId: string;
  spreadsheetName: string;
  count: number;
  rows: any[][];
  timestamp: string;
}

interface MonitoredSheet {
  id: string;
  name: string;
  lastCount: number;
}

export default function App() {
  const [sheets, setSheets] = useState<MonitoredSheet[]>(() => {
    const saved = localStorage.getItem('monitored_sheets');
    if (saved) {
      try {
        return JSON.parse(saved).map((s: any) => ({ ...s, lastCount: 0 }));
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  const [newSheetId, setNewSheetId] = useState('');
  
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
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  });

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'monitoring' | 'error'>('idle');
  const [updates, setUpdates] = useState<RowUpdate[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  
  const [themeColor, setThemeColor] = useState(() => localStorage.getItem('theme_color') || '#10b981');
  const [appName, setAppName] = useState(() => localStorage.getItem('app_name') || 'Nottiffy');
  const [showSettings, setShowSettings] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isConfigValid, setIsConfigValid] = useState<boolean | null>(null);

  useEffect(() => {
    const checkConfig = async () => {
      try {
        const response = await fetch('/api/health');
        const data = await response.json();
        setIsConfigValid(data.gasConfigured);
      } catch (e) {
        setIsConfigValid(false);
      }
    };
    checkConfig();
  }, []);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('new-rows', (update: RowUpdate) => {
      setUpdates(prev => [update, ...prev]);
      
      setSheets(prev => prev.map(s => {
        if (s.id === update.spreadsheetId) {
          // Only update name if it's provided and we don't have a good one
          const newName = update.spreadsheetName || s.name;
          return { ...s, name: newName, lastCount: update.count };
        }
        return s;
      }));

      if (Notification.permission === 'granted') {
        new Notification(`${update.count} New Row(s) Added!`, {
          body: `Detected in ${update.spreadsheetName} at ${new Date(update.timestamp).toLocaleTimeString()}`,
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
    localStorage.setItem('monitored_sheets', JSON.stringify(sheets.map(({ id, name }) => ({ id, name }))));
    localStorage.setItem('poll_frequency', frequency.toString());
    localStorage.setItem('theme_color', themeColor);
    localStorage.setItem('app_name', appName);
  }, [sheets, frequency, themeColor, appName]);

  const addSheet = async () => {
    if (!newSheetId) return;
    if (sheets.some(s => s.id === newSheetId)) {
      alert('This Spreadsheet ID is already added');
      return;
    }

    setIsAdding(true);
    try {
      const response = await fetch(`/api/spreadsheet/info?spreadsheetId=${newSheetId}`);
      const data = await response.json();
      
      if (data.error) throw new Error(data.error);

      setSheets(prev => [...prev, { 
        id: newSheetId, 
        name: data.name || (newSheetId.substring(0, 8) + '...'), 
        lastCount: 0
      }]);
      setNewSheetId('');
    } catch (err: any) {
      alert(`Error adding spreadsheet: ${err.message}. Please check the ID and ensure your GAS script is deployed.`);
    } finally {
      setIsAdding(false);
    }
  };

  const removeSheet = (id: string) => {
    setSheets(prev => prev.filter(s => s.id !== id));
    if (selectedSheetId === id) setSelectedSheetId(null);
    if (isMonitoring) {
      stopMonitoring();
    }
  };

  const startMonitoring = async () => {
    if (sheets.length === 0 || !socket) {
      setError('Please add at least one spreadsheet');
      return;
    }

    setStatus('connecting');
    setError(null);

    try {
      const response = await fetch('/api/monitor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetIds: sheets.map(s => s.id),
          frequency,
          startDate,
          socketId: socket.id
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start monitoring');
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
    if (!socket) return;
    try {
      await fetch('/api/monitor/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socketId: socket.id })
      });
      setIsMonitoring(false);
      setStatus('idle');
    } catch (err) {
      console.error('Stop error:', err);
    }
  };

  const handleManualPoll = () => {
    if (!isMonitoring || !socket) return;
    setIsRefreshing(true);
    socket.emit('request-manual-poll');
  };

  const openSpreadsheet = (id: string) => {
    const url = `https://docs.google.com/spreadsheets/d/${id}/edit`;
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
        {/* Configuration Warning */}
        {isConfigValid === false && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 space-y-2"
          >
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle size={18} />
              <span>Configuration Required</span>
            </div>
            <p className="text-xs leading-relaxed">
              The <code className="bg-amber-100 px-1 rounded">GAS_URL</code> {appName} environment variable {isConfigValid} {process.env.GAS_URL}is not set on the server. 
              Please add it in the <b>Settings</b> menu (AI Studio) or your <code className="bg-amber-100 px-1 rounded">.env</code> file (Local) to enable monitoring.
            </p>
          </motion.div>
        )}

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
                    <PlusCircle size={16} /> Add Spreadsheet ID
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Enter Spreadsheet ID"
                      value={newSheetId}
                      onChange={e => setNewSheetId(e.target.value)}
                      className="flex-1 px-4 py-2 text-sm rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      onClick={addSheet}
                      disabled={isAdding}
                      className="px-4 py-2 rounded-xl bg-zinc-900 text-white text-sm font-bold hover:bg-zinc-800 transition-all disabled:opacity-50"
                    >
                      {isAdding ? <RefreshCw size={14} className="animate-spin" /> : 'Add'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {sheets.map(sheet => (
                      <div key={sheet.id} className="flex items-center justify-between p-2 bg-zinc-50 rounded-lg border border-zinc-100">
                        <span className="text-xs text-zinc-500 truncate max-w-[200px]">{sheet.id}</span>
                        <button 
                          onClick={() => removeSheet(sheet.id)}
                          className="text-zinc-400 hover:text-red-500 p-1 transition-colors"
                          title="Remove Spreadsheet"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>



              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Monitoring Controls */}
        <section className="bg-white rounded-3xl p-8 shadow-sm border border-zinc-100 space-y-6">
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
                  <>Stop Monitoring All</>
                ) : (
                  <>Start Monitoring All</>
                )}
              </button>

              {isMonitoring && (
                <button 
                  onClick={handleManualPoll}
                  disabled={isRefreshing}
                  className="w-full py-4 rounded-2xl font-bold bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Zap size={18} className={cn(isRefreshing && "animate-pulse text-yellow-500")} />
                  {isRefreshing ? 'Checking All...' : 'Refresh All Now'}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Monitored Spreadsheets Section */}
        <section className="bg-white rounded-3xl p-6 shadow-sm border border-zinc-100 space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Monitored Sheets</h2>
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                isMonitoring ? "bg-emerald-500 animate-pulse" : "bg-zinc-300"
              )} />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                {frequency}m Polling
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {sheets.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-zinc-100 rounded-2xl">
                <p className="text-xs text-zinc-400 italic">No spreadsheets added yet.</p>
              </div>
            ) : (
              sheets.map((sheet) => (
                <div 
                  key={sheet.id}
                  onClick={() => setSelectedSheetId(selectedSheetId === sheet.id ? null : sheet.id)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-2xl border transition-all text-left cursor-pointer",
                    selectedSheetId === sheet.id 
                      ? "bg-white border-emerald-500 shadow-md ring-2 ring-emerald-500/10" 
                      : "bg-zinc-50 border-zinc-100 hover:bg-zinc-100"
                  )}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setSelectedSheetId(selectedSheetId === sheet.id ? null : sheet.id);
                    }
                  }}
                >
                  {/* Count Circle */}
                  <div 
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold text-xs transition-all",
                      sheet.lastCount > 0 
                        ? "bg-emerald-500 text-white scale-110 shadow-lg shadow-emerald-200" 
                        : "bg-zinc-200 text-zinc-500"
                    )}
                  >
                    {sheet.lastCount}
                  </div>

                  {/* Name and Link */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm truncate text-zinc-700">{sheet.name}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          openSpreadsheet(sheet.id);
                        }}
                        className="text-zinc-400 hover:text-zinc-600 transition-colors"
                        title="Open Spreadsheet"
                      >
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>


        {/* Updates Feed */}
        {selectedSheetId && (
          <section className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">
                Updates for {sheets.find(s => s.id === selectedSheetId)?.name || 'Selected Sheet'}
              </h3>
              <button 
                onClick={() => setSelectedSheetId(null)}
                className="text-[10px] font-bold text-emerald-600 uppercase hover:underline"
              >
                Hide Updates
              </button>
            </div>
            
            <div className="space-y-3">
              {updates.filter(u => u.spreadsheetId === selectedSheetId).length === 0 ? (
                <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-zinc-200">
                  <p className="text-zinc-400 text-sm italic">No updates found for this spreadsheet.</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {updates
                    .filter(u => u.spreadsheetId === selectedSheetId)
                    .map((update) => (
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
                          <h4 className="font-bold text-zinc-900">
                            {update.count} New Row{update.count > 1 ? 's' : ''}
                            <span className="ml-2 text-[10px] font-normal text-zinc-400">
                              in {update.spreadsheetName || sheets.find(s => s.id === update.spreadsheetId)?.name || update.spreadsheetId.substring(0, 8)}
                            </span>
                          </h4>
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
        )}
      </main>
    </div>
  );
}
