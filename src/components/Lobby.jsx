import { useState } from 'react';
import './Lobby.css';
import { generateBotName } from '../utils/botLogic';

const Lobby = ({ onCreateGame, onJoinGame, onCreateLocalGame, playerName, setPlayerName }) => {
  const [mode, setMode] = useState('local'); // 'local' or 'remote'
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');
  
  // Local mode state
  const [localPlayerCount, setLocalPlayerCount] = useState(2);
  const [localPlayerNames, setLocalPlayerNames] = useState(['', '', '', '', '', '']);
  const [localPlayerBots, setLocalPlayerBots] = useState([false, false, false, false, false, false]);
  const [localPlayerDifficulties, setLocalPlayerDifficulties] = useState(['medium', 'medium', 'medium', 'medium', 'medium', 'medium']);
  const [localBotNames, setLocalBotNames] = useState([
    generateBotName(),
    generateBotName(),
    generateBotName(),
    generateBotName(),
    generateBotName(),
    generateBotName()
  ]);

  const handleCreate = async () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }

    setIsCreating(true);
    setError('');
    
    try {
      await onCreateGame(playerName);
    } catch (err) {
      setError('Failed to create game: ' + err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoin = async () => {
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    setIsJoining(true);
    setError('');
    
    try {
      await onJoinGame(roomCode, playerName);
    } catch (err) {
      setError('Failed to join game: ' + err.message);
    } finally {
      setIsJoining(false);
    }
  };

  const handleLocalPlayerNameChange = (index, value) => {
    const newNames = [...localPlayerNames];
    newNames[index] = value;
    setLocalPlayerNames(newNames);
  };

  const handleLocalPlayerBotToggle = (index) => {
    const newBots = [...localPlayerBots];
    newBots[index] = !newBots[index];
    setLocalPlayerBots(newBots);
  };

  const handleLocalPlayerDifficultyChange = (index, difficulty) => {
    const newDifficulties = [...localPlayerDifficulties];
    newDifficulties[index] = difficulty;
    setLocalPlayerDifficulties(newDifficulties);
  };

  const handleStartLocalGame = async () => {
    const names = localPlayerNames.slice(0, localPlayerCount);
    const bots = localPlayerBots.slice(0, localPlayerCount);
    const difficulties = localPlayerDifficulties.slice(0, localPlayerCount);
    const botNames = localBotNames.slice(0, localPlayerCount);
    
    // Check that human players have names
    const invalidPlayers = names.filter((name, index) => !bots[index] && !name.trim());
    
    if (invalidPlayers.length > 0) {
      setError('Please enter names for all human players');
      return;
    }

    setIsCreating(true);
    setError('');
    
    try {
      // Pass bot configuration along with names
      const playerConfigs = names.map((name, index) => ({
        name: bots[index] ? botNames[index] : name,
        isBot: bots[index],
        botDifficulty: bots[index] ? difficulties[index] : undefined
      }));
      await onCreateLocalGame(playerConfigs);
    } catch (err) {
      setError('Failed to create local game: ' + err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const isLocalGameReady = () => {
    const names = localPlayerNames.slice(0, localPlayerCount);
    const bots = localPlayerBots.slice(0, localPlayerCount);
    // All human players must have names
    return names.every((name, index) => bots[index] || name.trim().length > 0);
  };


  return (
    <div className="lobby">
      <h1>Mantid</h1>
      <p className="subtitle">A colorfully cutthroat card game</p>

      <div className="lobby-form">
        {/* Mode Tabs */}
        <div className="mode-tabs">
          <button
            className={`tab ${mode === 'local' ? 'active' : ''}`}
            onClick={() => {
              setMode('local');
              setError('');
            }}
          >
            Local
          </button>
          <button
            className={`tab ${mode === 'remote' ? 'active' : ''}`}
            onClick={() => {
              setMode('remote');
              setError('');
            }}
          >
            Remote
          </button>
        </div>

        {/* Local Mode */}
        {mode === 'local' && (
          <div className="local-mode">
            <div className="input-group player-count-group">
              <label htmlFor="playerCount">Number of Players:</label>
              <div className="slider-container">
                <input
                  type="range"
                  id="playerCount"
                  min="2"
                  max="6"
                  value={localPlayerCount}
                  onChange={(e) => {
                    setLocalPlayerCount(parseInt(e.target.value));
                    setError('');
                  }}
                  className="player-count-slider"
                />
                <span className="player-count-value">{localPlayerCount}</span>
              </div>
            </div>

            <button
              onClick={handleStartLocalGame}
              disabled={isCreating || !isLocalGameReady()}
              className="btn btn-primary btn-start-game"
            >
              {isCreating ? 'Starting...' : 'Start Game'}
            </button>

            <div className="player-names">
              {Array.from({ length: localPlayerCount }).map((_, index) => (
                <div key={index} className="player-config">
                  <div className="player-header">
                    <label htmlFor={`player${index + 1}`}>
                      Player {index + 1}
                    </label>
                    <div className="toggle-wrapper">
                      <span className="toggle-label">Bot</span>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={localPlayerBots[index]}
                          onChange={() => handleLocalPlayerBotToggle(index)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  </div>
                  
                  {localPlayerBots[index] ? (
                    <div className="bot-config">
                      <div className={`bot-name bot-name-${localPlayerDifficulties[index]}`}>
                        🤖 {localBotNames[index]}
                      </div>
                      <select
                        value={localPlayerDifficulties[index]}
                        onChange={(e) => handleLocalPlayerDifficultyChange(index, e.target.value)}
                        className="bot-difficulty-dropdown"
                      >
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                    </div>
                  ) : (
                    <input
                      id={`player${index + 1}`}
                      type="text"
                      value={localPlayerNames[index]}
                      onChange={(e) => handleLocalPlayerNameChange(index, e.target.value)}
                      placeholder={`Enter name for Player ${index + 1}`}
                      maxLength={20}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Remote Mode */}
        {mode === 'remote' && (
          <div className="remote-mode">
            <div className="input-group">
              <label htmlFor="playerName">Your Name</label>
              <input
                id="playerName"
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter your name"
                maxLength={20}
              />
            </div>

            <div className="actions">
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="btn btn-primary"
              >
                {isCreating ? 'Creating...' : 'Create Game'}
              </button>

              <div className="divider">OR</div>

              <div className="input-group">
                <label htmlFor="roomCode">Room Code</label>
                <input
                  id="roomCode"
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Enter 4-letter code"
                  maxLength={4}
                />
              </div>

              <button
                onClick={handleJoin}
                disabled={isJoining}
                className="btn btn-secondary"
              >
                {isJoining ? 'Joining...' : 'Join Game'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="error">{error}</div>}
      </div>

      <div className="rules-link">
        <details>
          <summary>How to Play</summary>
          <div className="rules">
            <h3>Goal</h3>
            <p>Be the first player to have 10 or more cards in your Score Pile (15 for 2 players).</p>
            
            <h3>On Your Turn</h3>
            <p><strong>Score:</strong> Draw a card into YOUR tank. If it matches any cards there, move all matching cards to your Score Pile.</p>
            <p><strong>Steal:</strong> Draw a card into ANOTHER player's tank. If it matches, steal all matching cards to YOUR tank.</p>
            
            <h3>Strategy</h3>
            <p>The back of each card shows 3 possible colors. Use this info to make smart decisions!</p>
          </div>
        </details>
      </div>
    </div>
  );
};

export default Lobby;
