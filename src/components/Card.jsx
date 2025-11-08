import './Card.css';

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
              style={{ backgroundColor: color }}
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
