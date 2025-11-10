import { useState, useEffect } from 'react';
import Card from './Card';
import './Tank.css';

// Define color order: Pink, Red, Orange, Yellow, Green, Blue, Purple
const COLOR_ORDER = ['pink', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];

const EMOJI_OPTIONS = ['👍', '😂', '😮', '🔥', '💯'];

const Tank = ({ 
  id,
  cards, 
  playerName, 
  scoreCount, 
  isCurrentTurn, 
  isCurrentPlayer, 
  isWinning,
  emojiQueue,
  onEmojiClick,
  hiddenCardIds = new Set(),
  flippingCardIds = new Set(),
  fadingOutCardIds = new Set()
}) => {
  const [visibleEmojis, setVisibleEmojis] = useState([]);
  const [previousCardIds, setPreviousCardIds] = useState(new Set());
  const [fadingInCardIds, setFadingInCardIds] = useState(new Set());

  // Handle emoji queue - filter out expired emojis
  useEffect(() => {
    if (!emojiQueue || emojiQueue.length === 0) {
      setVisibleEmojis([]);
      return;
    }

    const now = Date.now();
    const activeEmojis = emojiQueue.filter(item => {
      const age = now - item.timestamp;
      return age < 5000; // 5 second total duration
    });

    setVisibleEmojis(activeEmojis);

    // Set up interval to check for expired emojis
    const interval = setInterval(() => {
      const currentTime = Date.now();
      const stillActive = activeEmojis.filter(item => {
        const age = currentTime - item.timestamp;
        return age < 5000;
      });
      
      if (stillActive.length !== visibleEmojis.length) {
        setVisibleEmojis(stillActive);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [emojiQueue]);

  // Detect cards that should fade in (new cards or cards becoming visible)
  useEffect(() => {
    const currentVisibleIds = new Set();
    cards.forEach(card => {
      if (!hiddenCardIds.has(card.id)) {
        currentVisibleIds.add(card.id);
      }
    });
    
    const cardsToFadeIn = new Set();
    
    // Find cards that are NOW visible but WEREN'T visible before
    currentVisibleIds.forEach(id => {
      if (!previousCardIds.has(id)) {
        cardsToFadeIn.add(id);
      }
    });
    
    if (cardsToFadeIn.size > 0) {
      setFadingInCardIds(cardsToFadeIn);
      
      // Clear fade-in state after animation completes
      setTimeout(() => {
        setFadingInCardIds(new Set());
      }, 500); // Match CSS animation duration
    }
    
    // Update previous card IDs to track currently visible cards
    setPreviousCardIds(currentVisibleIds);
  }, [cards, hiddenCardIds]);

  // Filter out hidden cards and group cards by color for display
  const visibleCards = cards.filter(card => !hiddenCardIds.has(card.id));
  const groupedCards = visibleCards.reduce((acc, card) => {
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
    <div 
      id={id}
      className={`tank ${isCurrentTurn ? 'active-turn' : ''} ${isCurrentPlayer ? 'current-player' : 'other-player'}`}
    >
      <div className="tank-header">
        <div className="player-info">
          <span className="player-name">{playerName}</span>
          {isCurrentTurn && <span className="turn-indicator">Active</span>}
          {isCurrentPlayer && !isCurrentTurn && <span className="you-badge">You</span>}
          
          {/* Emoji queue display - visible to OTHER players only (not the sender) */}
          {!isCurrentPlayer && visibleEmojis.length > 0 && (
            <div className="emoji-queue">
              {visibleEmojis.map((item) => {
                const age = Date.now() - item.timestamp;
                const isVisible = age >= 0 && age < 5000;
                return (
                  <div 
                    key={item.id} 
                    className={`emoji-display ${isVisible ? 'visible' : ''}`}
                  >
                    {item.emoji}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="score-display">
          Score: <strong className={isWinning ? 'winning-score' : ''}>{scoreCount}</strong>
        </div>
      </div>
      
      <div className="tank-cards">
        {/* Active cards in tank */}
        {cards.length === 0 && scoreCount === 0 ? (
          <div className="empty-tank">No cards</div>
        ) : (
          sortedColors.map((color) => (
            <div key={color} className="card-stack">
              {groupedCards[color].map((card, index) => {
                const isFlipping = flippingCardIds.has(card.id);
                const isFadingOut = fadingOutCardIds.has(card.id);
                return (
                  <div 
                    key={card.id} 
                    className={`stacked-card ${fadingInCardIds.has(card.id) ? 'fade-in' : ''} ${isFlipping ? 'flipping-to-back' : ''} ${isFadingOut ? 'fade-out' : ''}`}
                    style={{ marginTop: index > 0 ? '-90px' : '0' }}
                  >
                    <Card card={card} showBack={isFlipping} />
                  </div>
                );
              })}
            </div>
          ))
        )}
        
        {/* Score Pile - rightmost position (last pile) */}
        {scoreCount > 0 && (
          <div className="score-pile" id={`${id}-score-pile`}>
            <div className="score-pile-stack">
              {[...Array(Math.min(scoreCount, 5))].map((_, index) => (
                <div 
                  key={index}
                  className="score-pile-card"
                  style={{ 
                    marginTop: index > 0 ? '-90px' : '0',
                    zIndex: index
                  }}
                >
                  <Card card={{ color: 'back', backColors: ['gray', 'gray', 'gray'] }} showBack={true} />
                </div>
              ))}
              {scoreCount > 5 && (
                <div className="score-pile-count">+{scoreCount - 5}</div>
              )}
            </div>
          </div>
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
