import { useState, useEffect } from 'react';
import Card from './Card';
import './Tank.css';

// Define color order: Pink, Red, Orange, Yellow, Green, Blue, Purple
const COLOR_ORDER = ['pink', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];

const EMOJI_OPTIONS = ['👍', '😂', '😮', '🔥', '💯'];

const Tank = ({ 
  cards, 
  playerName, 
  scoreCount, 
  isCurrentTurn, 
  isCurrentPlayer, 
  isWinning,
  playerEmoji,
  emojiTimestamp,
  onEmojiClick 
}) => {
  const [showEmoji, setShowEmoji] = useState(false);
  const [displayEmoji, setDisplayEmoji] = useState(null);

  // Handle emoji display timing
  useEffect(() => {
    if (playerEmoji && emojiTimestamp) {
      const now = Date.now();
      const age = now - emojiTimestamp;
      
      // Total duration is 5 seconds (500ms fade in + 4000ms visible + 500ms fade out)
      if (age < 5000) {
        setDisplayEmoji(playerEmoji);
        setShowEmoji(true);
        
        // Set timeout to hide emoji after remaining time
        const remainingTime = 5000 - age;
        const timeout = setTimeout(() => {
          setShowEmoji(false);
          setTimeout(() => setDisplayEmoji(null), 500); // Wait for fade out
        }, remainingTime);
        
        return () => clearTimeout(timeout);
      }
    }
  }, [playerEmoji, emojiTimestamp]);

  // Group cards by color for display
  const groupedCards = cards.reduce((acc, card) => {
    if (!acc[card.color]) {
      acc[card.color] = [];
    }
    acc[card.color].push(card);
    return acc;
  }, {});

  // Sort the grouped cards by defined color order
  const sortedColors = Object.keys(groupedCards).sort((a, b) => {
    return COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b);
  });

  const handleEmojiClick = (emoji) => {
    if (onEmojiClick) {
      onEmojiClick(emoji);
    }
  };

  return (
    <div className={`tank ${isCurrentTurn ? 'active-turn' : ''} ${isCurrentPlayer ? 'current-player' : 'other-player'}`}>
      <div className="tank-header">
        <div className="player-info">
          <span className="player-name">{playerName}</span>
          {isCurrentTurn && <span className="turn-indicator">Active</span>}
          {isCurrentPlayer && !isCurrentTurn && <span className="you-badge">You</span>}
          
          {/* Emoji display - visible to OTHER players only (not the sender) */}
          {!isCurrentPlayer && displayEmoji && (
            <div className={`emoji-display ${showEmoji ? 'visible' : ''}`}>
              {displayEmoji}
            </div>
          )}
        </div>
        <div className="score-display">
          Score: <strong className={isWinning ? 'winning-score' : ''}>{scoreCount}</strong>
        </div>
      </div>
      
      <div className="tank-cards">
        {cards.length === 0 ? (
          <div className="empty-tank">No cards</div>
        ) : (
          sortedColors.map((color) => (
            <div key={color} className="card-stack">
              {groupedCards[color].map((card, index) => (
                <div 
                  key={card.id} 
                  className="stacked-card"
                  style={{ marginTop: index > 0 ? '-90px' : '0' }}
                >
                  <Card card={card} />
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      
      {/* Emoji buttons - below cards, only visible for current player */}
      {isCurrentPlayer && (
        <div className="emoji-buttons">
          {EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              className="emoji-button"
              onClick={() => handleEmojiClick(emoji)}
              title={`Send ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Tank;
