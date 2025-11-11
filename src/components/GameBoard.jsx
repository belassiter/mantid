import { useState, useEffect } from 'react';
import Tank from './Tank';
import Card from './Card';
import { checkWinCondition } from '../utils/gameRules';
import { findMatchingCards } from '../utils/cardLogic';
import './GameBoard.css';

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

// Animation sequence definitions
const ANIMATION_SEQUENCES = {
  scoreSuccess: [
    { time: 0, action: 'flipCard', duration: 2600 },
    { time: 2600, action: 'moveToTank', duration: 800 },
    { time: 3400, action: 'arriveInTank', duration: 0 }, // Card arrives, movement stops
    { time: 3900, action: 'fadeIn', duration: 500 }, // THEN matching cards fade in (500ms later)
    { time: 4400, action: 'flipToBack', duration: 600 },
    { time: 5000, action: 'fadeOut', duration: 500 },
    { time: 5500, action: 'moveToScore', duration: 1000 },
    { time: 6500, action: 'releaseSnapshot' },
    { time: 7500, action: 'nextPlayer' }
  ],
  scoreFail: [
    { time: 0, action: 'flipCard', duration: 2600 },
    { time: 2600, action: 'moveToTank', duration: 800 },
    { time: 3400, action: 'arriveInTank', duration: 0 }, // Card arrives in tank
    { time: 3900, action: 'fadeIn', duration: 500 }, // Card fades in (no matches, just the one card)
    { time: 4400, action: 'releaseSnapshot' },
    { time: 4400, action: 'nextPlayer' }
  ],
  stealSuccess: [
    { time: 0, action: 'flipCard', duration: 2600 },
    { time: 2600, action: 'moveToTargetTank', duration: 800 },
    { time: 3400, action: 'arriveInTank', duration: 0 }, // Card arrives
    { time: 3900, action: 'fadeIn', duration: 500 }, // Matching cards fade in
    { time: 4400, action: 'flipToBack', duration: 600 },
    { time: 5000, action: 'fadeOut', duration: 500 },
    { time: 5500, action: 'moveToActingTank', duration: 1000 },
    { time: 6500, action: 'releaseSnapshot' },
    { time: 7500, action: 'nextPlayer' }
  ],
  stealFail: [
    { time: 0, action: 'flipCard', duration: 2600 },
    { time: 2600, action: 'moveToTargetTank', duration: 800 },
    { time: 3400, action: 'arriveInTank', duration: 0 }, // Card arrives
    { time: 3900, action: 'fadeIn', duration: 500 }, // Card fades in
    { time: 4400, action: 'releaseSnapshot' },
    { time: 4400, action: 'nextPlayer' }
  ]
};

const GameBoard = ({ game, currentUserId, onScore, onSteal, onEmojiSend, isLocalMode = false }) => {
  // Animation snapshot - frozen game state during animations
  const [animationSnapshot, setAnimationSnapshot] = useState(null);
  const [drawnCardInTank, setDrawnCardInTank] = useState(null); // Track when to show drawn card in tank
  const [hiddenCardIds, setHiddenCardIds] = useState(new Set()); // Cards to hide during animation
  
  // Animation state
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [flippingCard, setFlippingCard] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [targetTankIndex, setTargetTankIndex] = useState(null);
  const [cardPosition, setCardPosition] = useState({ startX: 0, startY: 0, endX: 0, endY: 0 });
  const [stolenCards, setStolenCards] = useState([]);
  const [animatingStolenCards, setAnimatingStolenCards] = useState(false);
  const [lastActionTimestamp, setLastActionTimestamp] = useState(null);
  const [previousDrawPile, setPreviousDrawPile] = useState([]);
  const [previousPlayers, setPreviousPlayers] = useState([]);
  const [displayCurrentPlayerIndex, setDisplayCurrentPlayerIndex] = useState(game.currentPlayerIndex);
  const [isAnimationScheduled, setIsAnimationScheduled] = useState(false);
  const [actingPlayerIndex, setActingPlayerIndex] = useState(null);
  const [scoringCards, setScoringCards] = useState([]);
  const [animatingScoringCards, setAnimatingScoringCards] = useState(false);
  const [buttonsFadingOut, setButtonsFadingOut] = useState(false);
  const [flippingCardsInTank, setFlippingCardsInTank] = useState(new Set());
  const [fadingOutCardsInTank, setFadingOutCardsInTank] = useState(new Set());
  
  // Use snapshot during animations, live game state otherwise
  const displayState = animationSnapshot || game;

  const currentPlayer = game.players.find(p => p.id === currentUserId);
  const currentPlayerIndex = game.players.findIndex(p => p.id === currentUserId);
  // In local mode, it's always "your turn" since everyone is at the same device
  const isMyTurn = isLocalMode ? true : (displayCurrentPlayerIndex === currentPlayerIndex);
  
  // Check for winner - but only show winner screen after animations complete
  const winner = !isAnimationScheduled && game.players.find(p => 
    checkWinCondition(p.scoreCount, game.players.length)
  );

  // Animation execution engine
  const executeAnimationSequence = (sequenceName, context) => {
    const sequence = ANIMATION_SEQUENCES[sequenceName];
    const timeouts = [];
    
    sequence.forEach(step => {
      const timeout = setTimeout(() => {
        switch (step.action) {
          case 'flipCard':
            setFlippingCard(context.drawnCard);
            setIsFlipping(true);
            setTargetTankIndex(context.targetTankIndex);
            // Hide all matching cards (except drawn card) at start
            if (context.cardsToAnimate && context.cardsToAnimate.length > 0) {
              const idsToHide = context.cardsToAnimate
                .filter(c => c.id !== context.drawnCard.id)
                .map(c => c.id);
              setHiddenCardIds(new Set(idsToHide));
            }
            break;
            
          case 'moveToTank':
          case 'moveToTargetTank':
            setIsFlipping(false);
            setIsMoving(true);
            break;
            
          case 'arriveInTank':
            setIsMoving(false);
            setFlippingCard(null);
            setTargetTankIndex(null);
            // Card has arrived but don't add to display yet
            // Wait for fadeIn step to actually show it
            break;
            
          case 'fadeIn':
            // NOW reveal all cards - they will fade in with the Tank's automatic fade-in
            setHiddenCardIds(new Set()); // Unhide all cards
            if (context.drawnCard && context.targetTankIndex !== null) {
              setDrawnCardInTank({
                card: context.drawnCard,
                tankIndex: context.targetTankIndex
              });
            }
            break;
            
          case 'flipToBack':
            if (context.cardsToAnimate && context.cardsToAnimate.length > 0) {
              setFlippingCardsInTank(new Set(context.cardsToAnimate.map(c => c.id)));
              setActingPlayerIndex(context.actingPlayerIndex);
            }
            break;
            
          case 'fadeOut':
            if (context.cardsToAnimate && context.cardsToAnimate.length > 0) {
              setFlippingCardsInTank(new Set()); // Clear flipping state
              setFadingOutCardsInTank(new Set(context.cardsToAnimate.map(c => c.id)));
            }
            break;
            
          case 'moveToScore':
            setFlippingCardsInTank(new Set());
            setFadingOutCardsInTank(new Set());
            setScoringCards(context.cardsToAnimate.map(card => ({
              ...card,
              startX: 0,
              startY: 0,
              endX: 0,
              endY: 0
            })));
            setAnimatingScoringCards(true);
            break;
            
          case 'moveToActingTank':
            setFlippingCardsInTank(new Set());
            setFadingOutCardsInTank(new Set());
            setStolenCards(context.cardsToAnimate.map(card => ({
              ...card,
              startX: 0,
              startY: 0,
              endX: 0,
              endY: 0,
              sourceTankIndex: context.sourceTankIndex
            })));
            setAnimatingStolenCards(true);
            break;
            
          case 'releaseSnapshot':
            setAnimationSnapshot(null);
            setDrawnCardInTank(null);
            setHiddenCardIds(new Set());
            setAnimatingScoringCards(false);
            setAnimatingStolenCards(false);
            setScoringCards([]);
            setStolenCards([]);
            setActingPlayerIndex(null);
            break;
            
          case 'nextPlayer':
            setDisplayCurrentPlayerIndex(game.currentPlayerIndex);
            setIsAnimationScheduled(false);
            break;
        }
      }, step.time);
      
      timeouts.push(timeout);
    });
    
    return () => timeouts.forEach(clearTimeout);
  };

  // Detect when an action occurs and trigger animations for all players
  useEffect(() => {
    if (!game.lastAction) return;
    
    // Check if this is a new action
    if (game.lastAction.timestamp === lastActionTimestamp) return;
    
    // Check if we have the previous draw pile to get the card that was drawn
    if (previousDrawPile.length === 0) return;
    
    const drawnCard = previousDrawPile[previousDrawPile.length - 1];
    if (!drawnCard) return;
    
    setLastActionTimestamp(game.lastAction.timestamp);
    setIsAnimationScheduled(true);
    
    const action = game.lastAction.action;
    const wasSuccessful = game.lastAction.result === 'success';
    
    // Create snapshot of game state BEFORE animations start
    setAnimationSnapshot({
      ...game,
      players: previousPlayers,
      drawPile: previousDrawPile,
      currentPlayerIndex: game.currentPlayerIndex
    });
    
    if (action === 'score') {
      const actingPlayerIndex = game.players.findIndex(p => p.name === game.lastAction.player);
      if (actingPlayerIndex === -1) return;
      
      let cardsToScore = [];
      if (wasSuccessful && previousPlayers.length > 0 && previousPlayers[actingPlayerIndex]) {
        const previousActingPlayer = previousPlayers[actingPlayerIndex];
        const tempTank = [...previousActingPlayer.tank, drawnCard];
        cardsToScore = findMatchingCards(tempTank, drawnCard.color);
      }
      
      const sequenceName = wasSuccessful ? 'scoreSuccess' : 'scoreFail';
      executeAnimationSequence(sequenceName, {
        drawnCard,
        targetTankIndex: actingPlayerIndex,
        actingPlayerIndex,
        cardsToAnimate: cardsToScore
      });
      
    } else if (action === 'steal') {
      const actingPlayerIndex = game.players.findIndex(p => p.name === game.lastAction.player);
      const targetPlayerIndex = game.players.findIndex(p => p.name === game.lastAction.target);
      
      if (actingPlayerIndex === -1 || targetPlayerIndex === -1) return;
      
      let cardsToSteal = [];
      if (wasSuccessful && previousPlayers.length > 0 && previousPlayers[targetPlayerIndex]) {
        const previousTargetPlayer = previousPlayers[targetPlayerIndex];
        const tempTank = [...previousTargetPlayer.tank, drawnCard];
        const matchingCards = findMatchingCards(tempTank, drawnCard.color);
        cardsToSteal = matchingCards.filter(card => 
          previousTargetPlayer.tank.some(tc => tc.id === card.id)
        );
      }
      
      const sequenceName = wasSuccessful ? 'stealSuccess' : 'stealFail';
      const targetIndex = wasSuccessful ? actingPlayerIndex : targetPlayerIndex;
      
      executeAnimationSequence(sequenceName, {
        drawnCard,
        targetTankIndex: targetIndex,
        actingPlayerIndex,
        sourceTankIndex: targetPlayerIndex, // Where cards are stolen FROM
        cardsToAnimate: cardsToSteal
      });
    }
  }, [game.lastAction, previousDrawPile, game.players, game.currentPlayerIndex]);

  // Capture snapshot of game state when turn starts (BEFORE any actions)
  useEffect(() => {
    // Only capture when it becomes my turn and no animation is running
    if (isMyTurn && !isAnimationScheduled) {
      if (game.drawPile && game.drawPile.length > 0) {
        setPreviousDrawPile([...game.drawPile]);
      }
      if (game.players && game.players.length > 0) {
        setPreviousPlayers(game.players.map(p => ({
          ...p,
          tank: [...p.tank]
        })));
      }
    }
  }, [displayCurrentPlayerIndex, isAnimationScheduled]); // Only trigger when turn changes

  // Initialize display current player index on first load
  useEffect(() => {
    if (displayCurrentPlayerIndex === undefined || displayCurrentPlayerIndex === null) {
      setDisplayCurrentPlayerIndex(game.currentPlayerIndex);
    }
  }, []);

  // Reset button fade-out state when it becomes the current player's turn
  useEffect(() => {
    if (isMyTurn && !isAnimationScheduled) {
      setButtonsFadingOut(false);
    }
  }, [isMyTurn, isAnimationScheduled]);

  // Calculate start and target positions when moving card
  useEffect(() => {
    if (isMoving && targetTankIndex !== null) {
      // Get draw pile position
      const drawPileElement = document.querySelector('.card-flip-container');
      const tankElement = document.getElementById(`tank-${targetTankIndex}`);
      
      if (drawPileElement && tankElement) {
        const drawRect = drawPileElement.getBoundingClientRect();
        const tankRect = tankElement.getBoundingClientRect();
        
        const startX = drawRect.left + drawRect.width / 2;
        const startY = drawRect.top + drawRect.height / 2;
        const endX = tankRect.left + tankRect.width / 2;
        const endY = tankRect.top + tankRect.height / 2;
        
        setCardPosition({ startX, startY, endX, endY });
      }
    }
  }, [isMoving, targetTankIndex]);

  // Calculate positions for stolen cards animation
  useEffect(() => {
    if (animatingStolenCards && stolenCards.length > 0 && actingPlayerIndex !== null) {
      const sourceTankElement = document.getElementById(`tank-${stolenCards[0].sourceTankIndex}`);
      const targetTankElement = document.getElementById(`tank-${actingPlayerIndex}`);
      
      if (sourceTankElement && targetTankElement) {
        const sourceRect = sourceTankElement.getBoundingClientRect();
        const targetRect = targetTankElement.getBoundingClientRect();
        
        const startX = sourceRect.left + sourceRect.width / 2;
        const startY = sourceRect.top + sourceRect.height / 2;
        const endX = targetRect.left + targetRect.width / 2;
        const endY = targetRect.top + targetRect.height / 2;
        
        setStolenCards(prev => prev.map(card => ({
          ...card,
          startX,
          startY,
          endX,
          endY
        })));
      }
    }
  }, [animatingStolenCards, stolenCards.length, actingPlayerIndex]);

  // Calculate positions for scoring cards animation
  useEffect(() => {
    if (animatingScoringCards && scoringCards.length > 0 && actingPlayerIndex !== null) {
      const tankElement = document.getElementById(`tank-${actingPlayerIndex}`);
      const scorePileElement = document.querySelector(`#tank-${actingPlayerIndex}-score-pile`);
      
      if (tankElement && scorePileElement) {
        const tankRect = tankElement.getBoundingClientRect();
        const scorePileRect = scorePileElement.getBoundingClientRect();
        
        // Start from center of tank
        const startX = tankRect.left + tankRect.width / 2;
        const startY = tankRect.top + tankRect.height / 2;
        // End at score pile position
        const endX = scorePileRect.left + scorePileRect.width / 2;
        const endY = scorePileRect.top + scorePileRect.height / 2;
        
        setScoringCards(prev => prev.map(card => ({
          ...card,
          startX,
          startY,
          endX,
          endY
        })));
      }
    }
  }, [animatingScoringCards, scoringCards.length, actingPlayerIndex]);

  const handleScoreClick = () => {
    setButtonsFadingOut(true);
    onScore();
  };

  const handleStealClick = () => {
    setButtonsFadingOut(true);
    setShowActionModal(true);
  };

  const handleTargetSelect = (targetIndex) => {
    setSelectedTarget(targetIndex);
    setShowActionModal(false);
    onSteal(targetIndex);
  };

  const handleEmojiClick = (emoji) => {
    if (onEmojiSend) {
      onEmojiSend(currentPlayerIndex, emoji);
    }
  };

  if (winner) {
    // Sort players by score for summary
    const sortedPlayers = [...game.players].sort((a, b) => b.scoreCount - a.scoreCount);
    
    return (
      <div className="game-over">
        <div className="winner-announcement">
          <h1>🎉 {winner.name} Wins! 🎉</h1>
          <p className="winning-score">Final Score: {winner.scoreCount} cards</p>
          
          <div className="final-scores">
            <h3>Final Standings</h3>
            <div className="scores-list">
              {sortedPlayers.map((player, index) => (
                <div key={player.id} className={`score-item ${player.id === winner.id ? 'winner' : ''}`}>
                  <span className="rank">#{index + 1}</span>
                  <span className="player-name">{player.name}</span>
                  <span className="score">{player.scoreCount} cards</span>
                </div>
              ))}
            </div>
          </div>
          
          <button 
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-board">
      <div className="game-header">
        <h2>Mantid</h2>
        <div className="game-info">
          <span>Room: {displayState.roomCode}</span>
        </div>
      </div>

      <div className="draw-pile-section">
        <div className="draw-pile">
          {displayState.topCardBack ? (
            <>
              <p className="cards-left-counter">Cards Left: {displayState.drawPile.length}</p>
              <div className={`card-flip-container ${isFlipping ? 'flipping' : ''}`}>
                {isFlipping && flippingCard ? (
                  <>
                    <div className="card-flip-inner">
                      <div className="card-flip-back">
                        <Card card={displayState.topCardBack} showBack={true} size="large" />
                      </div>
                      <div className="card-flip-front">
                        <Card card={flippingCard} showBack={false} size="large" />
                      </div>
                    </div>
                  </>
                ) : (
                  <Card card={displayState.topCardBack} showBack={true} size="large" />
                )}
              </div>
              
              <div 
                className={`action-buttons ${buttonsFadingOut ? 'fading-out' : ''}`}
                style={{ visibility: isMyTurn && displayState.drawPile.length > 0 ? 'visible' : 'hidden' }}
              >
                <button 
                  className="btn btn-score"
                  onClick={handleScoreClick}
                  disabled={!isMyTurn || displayState.drawPile.length === 0}
                >
                  Score
                </button>
                <button 
                  className="btn btn-steal"
                  onClick={handleStealClick}
                  disabled={!isMyTurn || displayState.drawPile.length === 0}
                >
                  Steal
                </button>
              </div>
            </>
          ) : (
            <div className="empty-deck">Deck Empty!</div>
          )}
        </div>
      </div>

      <div className="players-area">
        {displayState.players.map((player, index) => {
          // Add drawn card to tank if it has arrived (after animation completes)
          let cardsToDisplay = player.tank;
          if (drawnCardInTank && drawnCardInTank.tankIndex === index) {
            cardsToDisplay = [...player.tank, drawnCardInTank.card];
          }
          
          // Pass flipping cards only to the acting player's tank
          const flippingCardsForThisTank = index === actingPlayerIndex 
            ? flippingCardsInTank 
            : new Set();
          
          // Pass fading out cards only to the acting player's tank
          const fadingOutCardsForThisTank = index === actingPlayerIndex 
            ? fadingOutCardsInTank 
            : new Set();
          
          // Pass hidden cards only to the acting player's tank
          const hiddenCardsForThisTank = index === actingPlayerIndex 
            ? hiddenCardIds 
            : new Set();
          
          return (
            <Tank
              key={player.id}
              id={`tank-${index}`}
              cards={cardsToDisplay}
              playerName={player.name}
              scoreCount={player.scoreCount}
              isCurrentTurn={displayCurrentPlayerIndex === index}
              isCurrentPlayer={isLocalMode ? (displayCurrentPlayerIndex === index) : (player.id === currentUserId)}
              isWinning={checkWinCondition(player.scoreCount, displayState.players.length)}
              emojiQueue={isLocalMode ? [] : (player.emojiQueue || [])}
              onEmojiClick={isLocalMode ? null : (player.id === currentUserId ? handleEmojiClick : null)}
              hiddenCardIds={hiddenCardsForThisTank}
              flippingCardIds={flippingCardsForThisTank}
              fadingOutCardIds={fadingOutCardsForThisTank}
            />
          );
        })}
      </div>

      {/* Moving card animation */}
      {isMoving && flippingCard && targetTankIndex !== null && (
        <div 
          className="moving-card"
          style={{
            '--start-x': `${cardPosition.startX}px`,
            '--start-y': `${cardPosition.startY}px`,
            '--end-x': `${cardPosition.endX}px`,
            '--end-y': `${cardPosition.endY}px`
          }}
        >
          <Card card={flippingCard} showBack={false} size="large" />
        </div>
      )}

      {/* Stolen cards animation */}
      {animatingStolenCards && stolenCards.map((card, idx) => (
        <div 
          key={`stolen-${card.id}-${idx}`}
          className="moving-card"
          style={{
            '--start-x': `${card.startX}px`,
            '--start-y': `${card.startY}px`,
            '--end-x': `${card.endX}px`,
            '--end-y': `${card.endY}px`,
            animationDelay: `${idx * 0.1}s`
          }}
        >
          <Card card={card} showBack={false} size="medium" />
        </div>
      ))}

      {/* Scoring cards animation */}
      {animatingScoringCards && scoringCards.map((card, idx) => (
        <div 
          key={`scoring-${card.id}-${idx}`}
          className="scoring-card"
          style={{
            '--start-x': `${card.startX}px`,
            '--start-y': `${card.startY}px`,
            '--end-x': `${card.endX}px`,
            '--end-y': `${card.endY}px`,
            animationDelay: `${idx * 0.1}s`
          }}
        >
          <Card card={card} showBack={true} size="medium" />
        </div>
      ))}

      {game.lastAction && (
        <div className="last-action">
          <strong>{game.lastAction.player}</strong> tried to {game.lastAction.action}
          {game.lastAction.target && ` from ${game.lastAction.target}`}
          {' - '}
          <span className={game.lastAction.result === 'success' ? 'success' : 'failure'}>
            {game.lastAction.result === 'success' 
              ? `✓ Match! (${game.lastAction.color})` 
              : `✗ No match (${game.lastAction.color})`
            }
          </span>
        </div>
      )}

      {showActionModal && (
        <div className="modal-overlay" onClick={() => setShowActionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Select a player to steal from:</h3>
            <div className="target-selection">
              {game.players.map((player, index) => (
                // In local mode, exclude the active player. In remote mode, exclude current user
                index !== (isLocalMode ? displayCurrentPlayerIndex : currentPlayerIndex) && (
                  <button
                    key={player.id}
                    className="target-button"
                    onClick={() => handleTargetSelect(index)}
                  >
                    <div className="target-name">{player.name}</div>
                    <div className="target-info">
                      <span>{player.tank.length} cards in tank</span>
                      <span>{player.scoreCount} in score</span>
                    </div>
                  </button>
                )
              ))}
            </div>
            <button 
              className="btn btn-secondary"
              onClick={() => {
                setShowActionModal(false);
                setButtonsFadingOut(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameBoard;
