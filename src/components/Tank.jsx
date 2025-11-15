import { useState, useEffect } from 'react';
import Card from './Card';
import './Tank.css';

// Define color order: Pink, Red, Orange, Yellow, Green, Blue, Purple
const COLOR_ORDER = ['pink', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];

const EMOJI_OPTIONS = ['👍', '😂', '😮', '🔥', '💯'];

// Generate consistent random colors for score pile based on seed
const getRandomColors = (seed) => {
  const colors = [...COLOR_ORDER];
  const result = [];
  let random = seed * 9301 + 49297; // Simple seeded random

  for (let i = 0; i < 3; i++) {
    random = (random * 9301 + 49297) % 233280;
    const index = Math.floor((random / 233280) * colors.length);
    result.push(colors[index]);
  }

  return result;
};

const Tank = ({
  id,
  cards,
  playerName,
  scoreCount,
  isCurrentTurn,
  isCurrentPlayer,
  isWinning,
  isBot = false,
  botDifficulty,
  emojiQueue,
  onEmojiClick,
  highlightedCardIds = new Set(),
  animatingCardIds = new Set(),
  flippingCard = null,
  isFlipping = false,
  isFlipComplete = false,
  isFadingFlippedCard = false,
  isLocalMode = false
}) => {
  const [visibleEmojis, setVisibleEmojis] = useState([]);

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

  const handleEmojiClick = (emoji) => {
    if (onEmojiClick) {
      onEmojiClick(emoji);
    }
  };

  // Group all cards by color for display
  const groupedCards = cards.reduce((acc, card) => {
    if (!acc[card.color]) {
      acc[card.color] = [];
    }
    acc[card.color].push(card);
    return acc;
  }, {});

  // Sort colors according to COLOR_ORDER
  const sortedColors = Object.keys(groupedCards).sort((a, b) => {
    return COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b);
  });

  // Determine bot indicator color based on difficulty
  const getBotIndicatorClass = () => {
    if (!isBot) return '';
    switch (botDifficulty) {
      case 'easy':
        return 'bot-indicator-easy';
      case 'hard':
        return 'bot-indicator-hard';
      default:
        return 'bot-indicator-medium';
    }
  };

  return (
    <div
      className={`tank ${isCurrentPlayer ? 'current-player' : 'other-player'} ${isCurrentTurn ? 'active-turn' : ''} ${isWinning ? 'winning' : ''}`}
      id={id}
    >
      <div className="tank-header">
        <div className="player-info">
          <div className={`player-name ${isBot ? `bot-name-${botDifficulty || 'medium'}` : ''}`}>
            {isBot && '🤖 '}{playerName}
          </div>
          {isCurrentPlayer && !isLocalMode && <div className="you-badge">YOU</div>}
          {isBot && <div className={`bot-indicator ${getBotIndicatorClass()}`}>BOT</div>}
          {isCurrentTurn && <div className="turn-indicator">TURN</div>}

          {/* Floating emojis */}
          {visibleEmojis.map((item, index) => {
            const age = Date.now() - item.timestamp;
            const opacity = Math.max(0, 1 - (age / 5000)); // Fade out over 5 seconds
            const translateY = -(age / 50); // Float up

            return (
              <div
                key={`${item.timestamp}-${index}`}
                className="floating-emoji"
                style={{
                  opacity,
                  transform: `translateY(${translateY}px)`,
                  left: `${20 + (index * 40)}px`
                }}
              >
                {item.emoji}
              </div>
            );
          })}
        </div>
        <div className="score-count">
          Score: <strong>{scoreCount}</strong>
        </div>
      </div>

      <div className="tank-content">
        {/* Tank card piles */}
        {sortedColors.length === 0 ? (
          <div className="empty-tank">No cards yet</div>
        ) : (
          sortedColors.map(color => (
            <div key={color} className="card-stack">
              {groupedCards[color].map((card, index) => {
                const isHighlighted = highlightedCardIds.has(card.id);
                const isAnimating = animatingCardIds.has(card.id);
                // If this card is currently being shown in the flipping overlay,
                // hide the tank copy until the overlay has finished to avoid a
                // duplicate visible card (overlay + tank simultaneously).
                // Consider the overlay active during the whole optimistic flip lifecycle
                const overlayActive = Boolean(flippingCard && flippingCard.id && (flippingCard.id === card.id) && (isFlipping || isFlipComplete || isFadingFlippedCard));

                // If the card is overlayed and overlay is active, don't render the tank copy
                if (overlayActive) {
                  return null;
                }

                return (
                  <div
                    key={card.id}
                    className={`stacked-card ${isHighlighted ? 'highlighted-card' : ''} ${isAnimating ? 'animating-card' : ''} ${isAnimating ? 'fade-in' : ''}`}
                    style={{ marginTop: index > 0 ? '-105px' : '0' }}
                  >
                    <Card card={card} showBack={false} />
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
              {[...Array(scoreCount)].map((_, index) => {
                const randomColors = getRandomColors(index);
                return (
                  <div
                    key={index}
                    className="score-pile-card"
                    style={{
                      marginTop: index > 0 ? '-110px' : '0',
                      zIndex: index
                    }}
                  >
                    <Card card={{ color: 'back', backColors: randomColors }} showBack={true} size="score-pile" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Emoji buttons - below cards, only visible for current player and when emoji handler is provided */}
      {isCurrentPlayer && onEmojiClick && (
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
