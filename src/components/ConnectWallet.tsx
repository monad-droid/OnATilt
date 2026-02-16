'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';

export default function ConnectWallet() {
  const { config, connected, setConfig, disconnect } = useAppStore();
  const [privateKey, setPrivateKey] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [testnet, setTestnet] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const handleConnect = () => {
    if (!privateKey.trim()) return;

    setConfig({
      privateKey: privateKey.trim(),
      walletAddress: walletAddress.trim() || undefined,
      testnet,
    });

    setPrivateKey('');
    setShowForm(false);
  };

  if (connected && config) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm text-green-400">Connected</span>
          {config.testnet && (
            <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
              TESTNET
            </span>
          )}
        </div>
        <button
          onClick={disconnect}
          className="text-sm text-gray-500 hover:text-red-400 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
      >
        Connect API
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white">Connect to Hyperliquid</h3>
        <p className="text-sm text-gray-400">
          Use an API Agent Wallet for security. Generate one at{' '}
          <a href="https://app.hyperliquid.xyz/API" target="_blank" rel="noopener" className="text-blue-400 underline">
            app.hyperliquid.xyz/API
          </a>
        </p>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Private Key</label>
          <input
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="0x..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Wallet Address <span className="text-gray-600">(for API agent wallets)</span>
          </label>
          <input
            type="text"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="0x..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={testnet}
            onChange={(e) => setTestnet(e.target.checked)}
            className="accent-blue-500"
          />
          <span className="text-sm text-gray-400">Use Testnet</span>
        </label>

        <div className="flex gap-3">
          <button
            onClick={handleConnect}
            disabled={!privateKey.trim()}
            className="flex-1 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-600 transition-colors"
          >
            Connect
          </button>
          <button
            onClick={() => setShowForm(false)}
            className="px-4 py-2 bg-gray-800 text-gray-400 rounded-lg text-sm hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>

        <p className="text-xs text-gray-600">
          Your key is sent to the server only for trade execution. It is not stored on the server.
        </p>
      </div>
    </div>
  );
}
