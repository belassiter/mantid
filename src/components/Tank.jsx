import Card from './Card';
import './Tank.css';

// Define color order: Pink, Red, Orange, Yellow, Green, Blue, Purple
const COLOR_ORDER = ['pink', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];

const Tank = ({ cards, playerName, scoreCount, isCurrentTurn, isCurrentPlayer, isWinning }) => {
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

  return (
    <div className={`tank ${isCurrentTurn ? 'active-turn' : ''} ${isCurrentPlayer ? 'current-player' : 'other-player'}`}>
      <div className="tank-header">
        <div className="player-info">
          <span className="player-name">{playerName}</span>
          {isCurrentTurn && <span className="turn-indicator">Active</span>}
          {isCurrentPlayer && !isCurrentTurn && <span className="you-badge">You</span>}
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
    </div>
  );
};

export default Tank;
