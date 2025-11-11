import './Card.css';

// Color mapping to match card fronts
const COLOR_MAP = {
  red: '#dc2626',
  blue: '#2563eb',
  green: '#16a34a',
  yellow: '#eab308',
  purple: '#9333ea',
  orange: '#ea580c',
  pink: '#ec4899'
};

// Define color order: Pink, Red, Orange, Yellow, Green, Blue, Purple
const COLOR_ORDER = ['pink', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];

const Card = ({ card, showBack = false, size = 'medium' }) => {
  if (!card) {
    return <div className={`card empty ${size}`}>?</div>;
  }

  if (showBack) {
    // Sort backColors according to COLOR_ORDER
    const sortedBackColors = card.backColors ? 
      [...card.backColors].sort((a, b) => {
        return COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b);
      }) : [];

    return (
      <div className={`card back ${size}`}>
        <div className="back-colors">
          {sortedBackColors.map((color, index) => (
            <div
              key={index}
              className={`back-color-rect ${size === 'score-pile' ? 'score-pile-size' : ''}`}
              style={{ backgroundColor: COLOR_MAP[color] || color }}
            >
              {size !== 'score-pile' && color}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`card front ${size} ${card.color}`}>
      <div className="card-color">{card.color}</div>
    </div>
  );
};

export default Card;
