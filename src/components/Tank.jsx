import Card from './Card';
import './Tank.css';

const Tank = ({ cards, playerName, scoreCount, isCurrentTurn, isCurrentPlayer }) => {
  // Group cards by color for display
  const groupedCards = cards.reduce((acc, card) => {
    if (!acc[card.color]) {
      acc[card.color] = [];
    }
    acc[card.color].push(card);
    return acc;
  }, {});

  return (
    <div className={`tank ${isCurrentTurn ? 'active-turn' : ''} ${isCurrentPlayer ? 'current-player' : 'other-player'}`}>
      <div className="tank-header">
        <div className="player-info">
          <span className="player-name">{playerName}</span>
          {isCurrentTurn && <span className="turn-indicator">⬅ Turn</span>}
          {isCurrentPlayer && !isCurrentTurn && <span className="you-badge">You</span>}
        </div>
        <div className="score-display">
          Score: <strong>{scoreCount}</strong>
        </div>
      </div>
      
      <div className="tank-cards">
        {cards.length === 0 ? (
          <div className="empty-tank">No cards</div>
        ) : (
          Object.entries(groupedCards).map(([color, colorCards]) => (
            <div key={color} className="card-stack">
              {colorCards.map((card, index) => (
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
