
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RawArticle, TranslationRecord, ProcessStatus, LogEntry } from './types';
import { DBService } from './services/dbService';
import { GeminiService } from './services/geminiService';
import { 
  FileUp, 
  Download, 
  Play, 
  Pause, 
  Trash2, 
  Database, 
  Languages, 
  CheckCircle,
  AlertCircle,
  Clock,
  Terminal,
  Zap,
  Cpu,
  Settings2,
  Key,
  ShieldAlert,
  X,
  Eye,
  EyeOff,
  Layers
} from 'lucide-react';

const App: React.FC = () => {
  const [pendingQueue, setPendingQueue] = useState<RawArticle[]>([]);
  const [translatedItems, setTranslatedItems] = useState<TranslationRecord[]>([]);
  const [status, setStatus] = useState<ProcessStatus>(ProcessStatus.IDLE);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<'gemini-3-flash-preview' | 'gemini-3-pro-preview'>('gemini-3-flash-preview');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [maxWorkers, setMaxWorkers] = useState(5); 
  const [batchSize, setBatchSize] = useState(25);
  const [hasApiKey, setHasApiKey] = useState(false);
  
  // API Key Management
  const [manualApiKey, setManualApiKey] = useState<string>('');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempKeyInput, setTempKeyInput] = useState('');
  const [showKeyText, setShowKeyText] = useState(false);
  
  const processingRef = useRef(false);
  const activeWorkersCount = useRef(0);
  const geminiRef = useRef(new GeminiService());
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Check API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      // 1. Check if we have a manual key in local storage
      const storedKey = localStorage.getItem('gemini_manual_key');
      if (storedKey) {
        setManualApiKey(storedKey);
        setHasApiKey(true);
        addLog("Manual API Key loaded from storage.", "success");
        return;
      }

      // 2. Check environment/window.aistudio
      try {
        if (window.aistudio && window.aistudio.hasSelectedApiKey) {
          const has = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(has);
          if (has) addLog("API Key detected from AI Studio.", "success");
        } else {
          setHasApiKey(!!process.env.API_KEY);
        }
      } catch (e) {
        console.error("Failed to check API key status", e);
      }
    };
    checkKey();
  }, []);

  // Load existing translations on mount
  useEffect(() => {
    const initData = async () => {
      await DBService.init();
      const records = await DBService.getAllTranslations();
      setTranslatedItems(records);
      addLog("Database initialized. Loaded " + records.length + " existing records.", "info");
    };
    initData();
  }, []);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => {
      const newLogs = [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        message,
        type
      }];
      return newLogs.slice(-50);
    });
  };

  const handleSetKey = async () => {
    if (window.aistudio?.openSelectKey) {
      try {
        await window.aistudio.openSelectKey();
        const has = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(has);
        if (has) {
          addLog("API Key updated via AI Studio.", "success");
          setError(null);
        }
      } catch (err) {
        addLog("Failed to set API Key.", "error");
      }
    } else {
      // Fallback to manual entry
      setTempKeyInput(manualApiKey);
      setShowKeyModal(true);
    }
  };

  const saveManualKey = () => {
    if (!tempKeyInput.trim()) {
      alert("Please enter a valid API key");
      return;
    }
    setManualApiKey(tempKeyInput.trim());
    localStorage.setItem('gemini_manual_key', tempKeyInput.trim());
    setHasApiKey(true);
    setShowKeyModal(false);
    addLog("Manual API Key saved.", "success");
    setError(null);
  };

  const clearManualKey = () => {
    setManualApiKey('');
    setTempKeyInput('');
    localStorage.removeItem('gemini_manual_key');
    setHasApiKey(false);
    setShowKeyModal(false);
    addLog("API Key removed.", "warning");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    addLog(`Reading file: ${file.name}...`);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        let parsed: any;
        if (content.trim().startsWith('[')) {
          parsed = JSON.parse(content);
        } else {
          parsed = content.split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
        }

        const rawArticles = Array.isArray(parsed) ? parsed : [parsed];
        const articles: RawArticle[] = rawArticles.map((a: any) => ({
          ...a,
          id: String(a.id)
        }));

        setPendingQueue(currentQueue => {
          const processedIds = new Set(translatedItems.map(item => String(item.id)));
          const pendingIds = new Set(currentQueue.map(item => String(item.id)));
          
          const newArticles: RawArticle[] = [];
          let skippedCount = 0;

          articles.forEach(article => {
            if (processedIds.has(article.id)) {
              skippedCount++;
            } else if (pendingIds.has(article.id)) {
              skippedCount++;
            } else {
              newArticles.push(article);
            }
          });

          if (newArticles.length === 0) {
            addLog(`All ${articles.length} articles skipped (duplicates).`, "warning");
            return currentQueue;
          }

          addLog(`Queued ${newArticles.length} new articles.`, "success");
          return [...currentQueue, ...newArticles];
        });
        
        setError(null);
      } catch (err) {
        const msg = "Failed to parse JSON file.";
        setError(msg);
        addLog(msg, "error");
      }
    };
    reader.readAsText(file);
  };

  const processNextBatch = useCallback(async () => {
    if (!processingRef.current) return;

    setPendingQueue(prevQueue => {
      if (prevQueue.length === 0) {
        if (activeWorkersCount.current === 0) {
          setIsProcessing(false);
          setStatus(ProcessStatus.COMPLETED);
          addLog("All pending tasks completed.", "success");
        }
        return prevQueue;
      }

      if (activeWorkersCount.current < maxWorkers) {
        const batch = prevQueue.slice(0, batchSize);
        const remaining = prevQueue.slice(batchSize);
        
        activeWorkersCount.current++;
        const workerId = activeWorkersCount.current;
        
        (async () => {
          try {
            addLog(`Worker #${workerId}: Translating batch of ${batch.length}...`);
            const odiaTexts = batch.map(a => a.text);
            
            // Pass the manual key if available
            const translations = await geminiRef.current.translateBatch(
              odiaTexts, 
              selectedModel,
              manualApiKey // Pass manual key here
            );

            const records: TranslationRecord[] = batch.map((article, idx) => ({
              id: article.id,
              odia: article.text,
              english: translations[idx] || "",
              headline_odia: article.headline,
              timestamp: Date.now()
            }));

            for (const record of records) {
              await DBService.saveTranslation(record);
            }

            setTranslatedItems(prev => [...prev, ...records]);
            addLog(`Worker #${workerId}: Batch successful.`, "success");
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error';
            addLog(`Worker #${workerId}: Batch error - ${errMsg}`, "error");
            
            if (errMsg.includes("API Key is missing")) {
                stopProcessing();
                setHasApiKey(false);
                setError("Processing stopped: API Key is missing or invalid.");
            }
            
            if (processingRef.current) {
              setPendingQueue(curr => [...batch, ...curr]);
            }
          } finally {
            activeWorkersCount.current--;
            if (processingRef.current) {
              processNextBatch();
            }
          }
        })();

        return remaining;
      }

      return prevQueue;
    });
  }, [selectedModel, maxWorkers, manualApiKey, batchSize]);

  // Manager loop
  useEffect(() => {
    if (isProcessing && processingRef.current) {
      const interval = setInterval(() => {
        if (activeWorkersCount.current < maxWorkers && pendingQueue.length > 0) {
          processNextBatch();
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, [isProcessing, pendingQueue.length, processNextBatch, maxWorkers]);

  const startProcessing = () => {
    if (!hasApiKey) {
      setError("Please connect your API Key before starting.");
      addLog("Cannot start: API Key missing.", "error");
      return;
    }
    if (pendingQueue.length === 0) return;
    setIsProcessing(true);
    processingRef.current = true;
    setStatus(ProcessStatus.PROCESSING);
    addLog(`Started processing with ${maxWorkers} workers, batch size ${batchSize}.`, "info");
    processNextBatch();
  };

  const stopProcessing = () => {
    setIsProcessing(false);
    processingRef.current = false;
    setStatus(ProcessStatus.IDLE);
    addLog("Processing paused.", "warning");
  };

  const clearData = async () => {
    if (window.confirm("Are you sure you want to clear all translations?")) {
      await DBService.clearAll();
      setTranslatedItems([]);
      setPendingQueue([]);
      setError(null);
      setLogs([]);
      addLog("Database cleared.", "info");
    }
  };

  const downloadTSV = () => {
    if (translatedItems.length === 0) return;
    addLog("Generating TSV export...");
    const header = "id\todia_text\tenglish_translation\ttimestamp\n";
    const body = translatedItems.map(item => {
      const cleanOdia = item.odia.replace(/[\t\n\r]/g, " ");
      const cleanEnglish = item.english.replace(/[\t\n\r]/g, " ");
      return `${item.id}\t${cleanOdia}\t${cleanEnglish}\t${new Date(item.timestamp).toISOString()}`;
    }).join('\n');
    const blob = new Blob([header + body], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `odia_english_dataset_${Date.now()}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("Dataset exported.", "success");
  };

  return (
    <div className="min-h-screen pb-20">
      <nav className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-indigo-600 rounded-lg">
              <Languages className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Odia-English Dataset Builder</h1>
          </div>
          <div className="flex items-center space-x-4">
            <button 
              onClick={handleSetKey}
              className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors border ${hasApiKey ? 'bg-green-50 text-green-700 border-green-100' : 'bg-indigo-50 text-indigo-700 border-indigo-100 animate-pulse'}`}
            >
              <Key size={18} />
              <span className="text-sm font-medium">{hasApiKey ? 'API Key Set' : 'Set API Key'}</span>
            </button>
            <button 
              onClick={downloadTSV}
              disabled={translatedItems.length === 0}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              <Download size={18} />
              <span>Export TSV</span>
            </button>
            <button 
              onClick={clearData}
              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={20} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 pt-8">
        {!hasApiKey && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between shadow-sm">
            <div className="flex items-center space-x-3">
              <ShieldAlert className="text-amber-500 w-6 h-6" />
              <div>
                <h3 className="text-sm font-bold text-amber-800">API Key Required</h3>
                <p className="text-sm text-amber-700">Connect your Google Gemini API key to start translating.</p>
              </div>
            </div>
            <button 
              onClick={handleSetKey}
              className="px-4 py-2 bg-amber-100 text-amber-800 rounded-lg font-semibold text-sm hover:bg-amber-200 transition-colors"
            >
              Enter API Key
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3">
            <AlertCircle className="text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-800">Something went wrong</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center space-x-4">
            <div className="p-3 bg-blue-50 rounded-xl">
              <Database className="text-blue-600 w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Dataset Size</p>
              <p className="text-2xl font-bold text-gray-900">{translatedItems.length}</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center space-x-4">
            <div className="p-3 bg-amber-50 rounded-xl">
              <Clock className="text-amber-600 w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Pending Queue</p>
              <p className="text-2xl font-bold text-gray-900">{pendingQueue.length}</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center space-x-4">
            <div className="p-3 bg-indigo-50 rounded-xl">
              <Zap className="text-indigo-600 w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Active Workers</p>
              <p className="text-2xl font-bold text-gray-900">{activeWorkersCount.current} / {maxWorkers}</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border shadow-sm flex items-center space-x-4">
            <div className="p-3 bg-green-50 rounded-xl">
              <CheckCircle className="text-green-600 w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Status</p>
              <p className="text-lg font-bold text-gray-900 capitalize">{status.toLowerCase()}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Controls Column */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white p-6 rounded-2xl border shadow-sm">
              <h2 className="text-lg font-semibold mb-4 flex items-center space-x-2">
                <FileUp className="text-indigo-600" size={20} />
                <span>Import Articles</span>
              </h2>
              <label className="block">
                <div className="relative group cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-8 transition-all hover:border-indigo-400 hover:bg-indigo-50/50 flex flex-col items-center justify-center space-y-2">
                  <FileUp className="text-gray-400 group-hover:text-indigo-500" size={32} />
                  <span className="text-sm font-medium text-gray-600 group-hover:text-indigo-700">Choose JSON File</span>
                  <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
                </div>
              </label>
            </div>

            <div className="bg-white p-6 rounded-2xl border shadow-sm">
              <h2 className="text-lg font-semibold mb-4 flex items-center space-x-2">
                <Cpu className="text-indigo-600" size={20} />
                <span>Model Selection</span>
              </h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSelectedModel('gemini-3-flash-preview')}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all border ${
                    selectedModel === 'gemini-3-flash-preview' 
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' 
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Gemini 3 Flash
                </button>
                <button
                  onClick={() => setSelectedModel('gemini-3-pro-preview')}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold transition-all border ${
                    selectedModel === 'gemini-3-pro-preview' 
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' 
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Gemini 3 Pro
                </button>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border shadow-sm">
              <h2 className="text-lg font-semibold mb-4 flex items-center space-x-2">
                <Zap className="text-indigo-600" size={20} />
                <span>Engine Control</span>
              </h2>
              
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center space-x-1">
                    <Layers size={12} />
                    <span>Batch Size (Articles)</span>
                  </label>
                  <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{batchSize}</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="50" 
                  step="1"
                  value={batchSize} 
                  onChange={(e) => setBatchSize(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-500 transition-all"
                />
                <p className="text-[10px] text-gray-400 mt-1">Higher batch sizes utilize more context window.</p>
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center space-x-1">
                    <Settings2 size={12} />
                    <span>Max Workers (Concurrency)</span>
                  </label>
                  <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded">{maxWorkers}</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="50" 
                  step="1"
                  value={maxWorkers} 
                  onChange={(e) => setMaxWorkers(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-500 transition-all"
                />
                <p className="text-[10px] text-gray-400 mt-1">Adjust based on your API rate limits.</p>
              </div>

              <div className="space-y-4">
                {isProcessing ? (
                  <button 
                    onClick={stopProcessing}
                    className="w-full py-3 px-4 bg-amber-100 text-amber-800 rounded-xl font-semibold flex items-center justify-center space-x-2 hover:bg-amber-200 transition-colors"
                  >
                    <Pause size={20} />
                    <span>Stop Workers</span>
                  </button>
                ) : (
                  <button 
                    onClick={startProcessing}
                    disabled={pendingQueue.length === 0 || !hasApiKey}
                    className="w-full py-3 px-4 bg-indigo-600 text-white rounded-xl font-semibold flex items-center justify-center space-x-2 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-all"
                  >
                    <Play size={20} />
                    <span>Run Parallel Workers</span>
                  </button>
                )}
                <div className="pt-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span>{translatedItems.length + pendingQueue.length > 0 ? Math.round((translatedItems.length / (translatedItems.length + pendingQueue.length)) * 100) : 0}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-500"
                      style={{ width: `${translatedItems.length + pendingQueue.length > 0 ? (translatedItems.length / (translatedItems.length + pendingQueue.length)) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Logging Section */}
            <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden flex flex-col h-64">
              <div className="px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Terminal size={14} className="text-green-400" />
                  <span className="text-xs font-mono text-gray-300">Live Status Log</span>
                </div>
              </div>
              <div ref={logContainerRef} className="flex-1 p-3 overflow-y-auto font-mono text-[10px] space-y-1">
                {logs.length === 0 && <p className="text-gray-600 italic">Engine idle...</p>}
                {logs.map(log => (
                  <div key={log.id} className="flex space-x-2">
                    <span className="text-gray-600">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span className={`
                      ${log.type === 'error' ? 'text-red-400' : ''}
                      ${log.type === 'success' ? 'text-green-400' : ''}
                      ${log.type === 'warning' ? 'text-amber-400' : ''}
                      ${log.type === 'info' ? 'text-blue-300' : ''}
                    `}>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Results Column */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col h-[calc(100vh-220px)]">
              <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Dataset Preview</h2>
                <div className="flex space-x-2">
                   <span className="text-xs font-medium px-2 py-1 bg-gray-200 rounded text-gray-600">
                    {translatedItems.length} Records
                  </span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {translatedItems.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 p-12 text-center">
                    <Database size={48} className="mb-4 opacity-20" />
                    <p className="text-sm">No translations generated yet.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {translatedItems.slice().reverse().map((item) => (
                      <div key={item.id} className="p-6 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-mono text-gray-400 uppercase">ID: {item.id}</span>
                          <span className="text-xs text-gray-400">{new Date(item.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-2">Odia</p>
                            <p className="odia-font text-gray-800 leading-relaxed text-sm line-clamp-4">{item.odia}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-2">English</p>
                            <p className="text-gray-700 leading-relaxed text-sm line-clamp-4">{item.english}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Manual API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900">Enter Gemini API Key</h3>
              <button onClick={() => setShowKeyModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Please enter your Google Gemini API key below. It will be stored locally in your browser for this session.
            </p>
            <div className="relative mb-6">
              <input
                type={showKeyText ? "text" : "password"}
                value={tempKeyInput}
                onChange={(e) => setTempKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all pr-12 font-mono text-sm"
              />
              <button 
                onClick={() => setShowKeyText(!showKeyText)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showKeyText ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={clearManualKey}
                className="flex-1 py-2.5 px-4 rounded-xl text-red-600 bg-red-50 hover:bg-red-100 font-medium transition-colors text-sm"
              >
                Clear Key
              </button>
              <button
                onClick={saveManualKey}
                className="flex-1 py-2.5 px-4 rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 font-medium transition-colors text-sm"
              >
                Save API Key
              </button>
            </div>
            <div className="mt-4 text-xs text-center text-gray-400">
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 underline">
                Get an API key from Google AI Studio
              </a>
            </div>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="fixed bottom-0 left-0 right-0 bg-indigo-900 text-white p-4 shadow-lg flex items-center justify-center z-50">
          <div className="flex items-center space-x-4">
            <div className="flex space-x-1">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <p className="text-sm font-medium">Engine running: {activeWorkersCount.current} workers active • {pendingQueue.length} batches remaining</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
