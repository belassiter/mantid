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

const Card = ({ card, showBack = false, size = 'medium' }) => {
  if (!card) {
    return <div className={`card empty ${size}`}>?</div>;
  }

  if (showBack) {
    return (
      <div className={`card back ${size}`}>
        <div className="back-colors">
          {card.backColors?.map((color, index) => (
            <div
              key={index}
              className="back-color-dot"
              style={{ backgroundColor: COLOR_MAP[color] || color }}
            />
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
