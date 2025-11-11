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

const GameBoard = ({ game, currentUserId, onScore, onSteal, onEmojiSend, isLocalMode = false }) => {
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [flippingCard, setFlippingCard] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [targetTankIndex, setTargetTankIndex] = useState(null);
  const [cardPosition, setCardPosition] = useState({ startX: 0, startY: 0, endX: 0, endY: 0 });
  const [stolenCards, setStolenCards] = useState([]);
  const [animatingStolenCards, setAnimatingStolenCards] = useState(false);
  const [hiddenCardIds, setHiddenCardIds] = useState(new Set());
  const [lastActionTimestamp, setLastActionTimestamp] = useState(null);
  const [previousDrawPile, setPreviousDrawPile] = useState([]);
  const [previousPlayers, setPreviousPlayers] = useState([]);
  const [displayCurrentPlayerIndex, setDisplayCurrentPlayerIndex] = useState(game.currentPlayerIndex);
  const [isAnimationScheduled, setIsAnimationScheduled] = useState(false);
  const [actingPlayerIndex, setActingPlayerIndex] = useState(null);
  const [scoringCards, setScoringCards] = useState([]);
  const [animatingScoringCards, setAnimatingScoringCards] = useState(false);
  const [buttonsFadingOut, setButtonsFadingOut] = useState(false);
  const [ghostCardsInTank, setGhostCardsInTank] = useState({ tankIndex: null, cards: [] });
  const [flippingCardsInTank, setFlippingCardsInTank] = useState(new Set());
  const [fadingOutCardsInTank, setFadingOutCardsInTank] = useState(new Set());
  const [frozenScoreCount, setFrozenScoreCount] = useState({}); // { tankIndex: actualScoreToShow }

  const currentPlayer = game.players.find(p => p.id === currentUserId);
  const currentPlayerIndex = game.players.findIndex(p => p.id === currentUserId);
  // In local mode, it's always "your turn" since everyone is at the same device
  const isMyTurn = isLocalMode ? true : (displayCurrentPlayerIndex === currentPlayerIndex);
  
  // Check for winner - but only show winner screen after animations complete
  const winner = !isAnimationScheduled && game.players.find(p => 
    checkWinCondition(p.scoreCount, game.players.length)
  );

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
    
    if (action === 'score') {
      const actingPlayerIndex = game.players.findIndex(p => p.name === game.lastAction.player);
      if (actingPlayerIndex === -1) return;
      
      // If successful, find the matching cards and freeze the old score
      let cardsToScore = [];
      if (wasSuccessful && previousPlayers.length > 0 && previousPlayers[actingPlayerIndex]) {
        const previousActingPlayer = previousPlayers[actingPlayerIndex];
        const tempTank = [...previousActingPlayer.tank, drawnCard];
        cardsToScore = findMatchingCards(tempTank, drawnCard.color);
        
        // Freeze the score at the OLD value (before Firebase updated it)
        setFrozenScoreCount({ [actingPlayerIndex]: previousActingPlayer.scoreCount });
        
        // Show old matching cards as ghosts IMMEDIATELY (Firebase already removed them)
        // This keeps them visible throughout the animation
        const oldTankCards = previousActingPlayer.tank.filter(card => 
          cardsToScore.some(c => c.id === card.id)
        );
        setGhostCardsInTank({ tankIndex: actingPlayerIndex, cards: oldTankCards });
      }
      
      // Step 1: Trigger drawpile card flip animation
      setFlippingCard(drawnCard);
      setIsFlipping(true);
      setTargetTankIndex(actingPlayerIndex);
      
      // Hide only the drawn card (it will appear after animation completes)
      setHiddenCardIds(new Set([drawnCard.id]));
      
      // Step 2: After flip, move drawpile card to tank (2600ms)
      setTimeout(() => {
        setIsFlipping(false);
        setIsMoving(true);
        
        // Step 3: After movement, card arrives in tank (800ms)
        setTimeout(() => {
          setIsMoving(false);
          setFlippingCard(null);
          setTargetTankIndex(null);
          
          // Unhide the drawn card so it fades in with the other cards
          setHiddenCardIds(new Set());
          
          if (wasSuccessful && cardsToScore.length > 0) {
            // Step 4: Wait for fade-in to complete, then flip scoring cards in tank (500ms fade)
            setTimeout(() => {
              setFlippingCardsInTank(new Set(cardsToScore.map(c => c.id)));
              setActingPlayerIndex(actingPlayerIndex);
              
              // Step 5: After flip, fade out the cards (600ms flip duration)
              setTimeout(() => {
                setFadingOutCardsInTank(new Set(cardsToScore.map(c => c.id)));
                
                // Step 6: After fade-out, hide and animate to score pile (500ms fade-out)
                setTimeout(() => {
                  setFlippingCardsInTank(new Set());
                  setFadingOutCardsInTank(new Set());
                  
                  // Hide scoring cards from tank, start animation to score pile
                  setHiddenCardIds(new Set(cardsToScore.map(c => c.id)));
                  setScoringCards(cardsToScore.map(card => ({
                    ...card,
                    startX: 0,
                    startY: 0,
                    endX: 0,
                    endY: 0
                  })));
                  setAnimatingScoringCards(true);
                  
                  // Step 7: Cards fade into score pile + score updates (1000ms)
                  setTimeout(() => {
                    setAnimatingScoringCards(false);
                    setScoringCards([]);
                    setHiddenCardIds(new Set());
                    setActingPlayerIndex(null);
                    setFrozenScoreCount({}); // Unfreeze, show the new score
                    setGhostCardsInTank({ tankIndex: null, cards: [] }); // Clear ghost cards
                    
                    // Update display current player 1 second after animation completes
                    setTimeout(() => {
                      setDisplayCurrentPlayerIndex(game.currentPlayerIndex);
                      setIsAnimationScheduled(false);
                    }, 1000);
                  }, 1000);
                }, 500);
              }, 600);
            }, 500);
          } else {
            // No scoring animation, just update display
            setTimeout(() => {
              setDisplayCurrentPlayerIndex(game.currentPlayerIndex);
              setIsAnimationScheduled(false);
            }, 1000);
          }
        }, 800);
      }, 2600);
      
    } else if (action === 'steal') {
      const actingPlayerIndex = game.players.findIndex(p => p.name === game.lastAction.player);
      const targetPlayerIndex = game.players.findIndex(p => p.name === game.lastAction.target);
      
      if (actingPlayerIndex === -1 || targetPlayerIndex === -1) return;
      
      setFlippingCard(drawnCard);
      setIsFlipping(true);
      
      let cardsToAnimate = [];
      
      if (wasSuccessful) {
        // Successful steal: draw pile card goes to acting player
        setTargetTankIndex(actingPlayerIndex);
        setActingPlayerIndex(actingPlayerIndex);
        
        // Find matching cards that were stolen (from PREVIOUS state before Firebase update)
        if (previousPlayers.length > 0 && previousPlayers[targetPlayerIndex]) {
          const previousTargetPlayer = previousPlayers[targetPlayerIndex];
          const tempTank = [...previousTargetPlayer.tank, drawnCard];
          const matchingCards = findMatchingCards(tempTank, drawnCard.color);
          cardsToAnimate = matchingCards.filter(card => 
            previousTargetPlayer.tank.some(tc => tc.id === card.id)
          );
          
          console.log('Steal animation starting:', {
            actingPlayerIndex,
            targetPlayerIndex,
            cardsToAnimate: cardsToAnimate.map(c => c.color),
            drawnCard: drawnCard.color
          });
        }
        
        // Don't hide cards or set ghosts yet - wait until drawn card arrives
          
        setTimeout(() => {
          setIsFlipping(false);
          setIsMoving(true);
          
          // NOW that card is moving to tank, hide the stolen cards from acting player
          // and show them as ghosts in target player
          if (cardsToAnimate.length > 0) {
            const allAnimatingCardIds = new Set([
              drawnCard.id,
              ...cardsToAnimate.map(card => card.id)
            ]);
            setHiddenCardIds(allAnimatingCardIds);
            setGhostCardsInTank({ tankIndex: targetPlayerIndex, cards: cardsToAnimate });
          }
          
          // Start stolen cards animation at the same time as draw pile card
          if (cardsToAnimate.length > 0) {
            setStolenCards(cardsToAnimate.map(card => ({
              ...card,
              sourceTankIndex: targetPlayerIndex,
              startX: 0,
              startY: 0,
              endX: 0,
              endY: 0
            })));
            setAnimatingStolenCards(true);
          }
          
          setTimeout(() => {
              setIsMoving(false);
              setFlippingCard(null);
              setTargetTankIndex(null);
              
              if (cardsToAnimate.length > 0) {
                // Wait for stolen cards animation to complete
                setTimeout(() => {
                  setAnimatingStolenCards(false);
                  setStolenCards([]);
                  setHiddenCardIds(new Set());
                  setActingPlayerIndex(null);
                  setGhostCardsInTank({ tankIndex: null, cards: [] });
                  
                  console.log('Steal animation complete, clearing ghost cards');
                  console.log('Target player tank after clear:', game.players[targetPlayerIndex]?.tank.map(c => c.color));
                  console.log('Acting player tank after clear:', game.players[actingPlayerIndex]?.tank.map(c => c.color));
                  
                  // Update display current player 1 second after animation completes
                  setTimeout(() => {
                    setDisplayCurrentPlayerIndex(game.currentPlayerIndex);
                    setIsAnimationScheduled(false);
                  }, 1000);
                }, 800);
              } else {
                // No stolen cards, just update display
                setHiddenCardIds(new Set());
                setActingPlayerIndex(null);
                setGhostCardsInTank({ tankIndex: null, cards: [] });
                setTimeout(() => {
                  setDisplayCurrentPlayerIndex(game.currentPlayerIndex);
                  setIsAnimationScheduled(false);
                }, 1000);
              }
            }, 800);
          }, 2600);
      } else {
        // Failed steal: card goes to target player
        setTargetTankIndex(targetPlayerIndex);
        
        // Hide the drawn card from the target player's tank during animation
        setHiddenCardIds(new Set([drawnCard.id]));
        
        setTimeout(() => {
          setIsFlipping(false);
          setIsMoving(true);
          
          setTimeout(() => {
            setIsMoving(false);
            setFlippingCard(null);
            setTargetTankIndex(null);
            
            // Clear hidden cards after animation
            setHiddenCardIds(new Set());
            
            // Update display current player 1 second after animation completes
            setTimeout(() => {
              setDisplayCurrentPlayerIndex(game.currentPlayerIndex);
              setIsAnimationScheduled(false);
            }, 1000);
          }, 800);
        }, 2600);
      }
    }
  }, [game.lastAction, previousDrawPile, game.players, game.currentPlayerIndex]);

  // Track previous draw pile state
  useEffect(() => {
    if (game.drawPile && game.drawPile.length > 0) {
      setPreviousDrawPile([...game.drawPile]);
    }
  }, [game.drawPile]);

  // Track previous players state
  useEffect(() => {
    if (game.players && game.players.length > 0) {
      setPreviousPlayers(game.players.map(p => ({
        ...p,
        tank: [...p.tank]
      })));
    }
  }, [game.players]);

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
          <span>Room: {game.roomCode}</span>
        </div>
      </div>

      <div className="draw-pile-section">
        <div className="draw-pile">
          {game.topCardBack ? (
            <>
              <p className="cards-left-counter">Cards Left: {game.drawPile.length}</p>
              <div className={`card-flip-container ${isFlipping ? 'flipping' : ''}`}>
                {isFlipping && flippingCard ? (
                  <>
                    <div className="card-flip-inner">
                      <div className="card-flip-back">
                        <Card card={game.topCardBack} showBack={true} size="large" />
                      </div>
                      <div className="card-flip-front">
                        <Card card={flippingCard} showBack={false} size="large" />
                      </div>
                    </div>
                  </>
                ) : (
                  <Card card={game.topCardBack} showBack={true} size="large" />
                )}
              </div>
              
              <div 
                className={`action-buttons ${buttonsFadingOut ? 'fading-out' : ''}`}
                style={{ visibility: isMyTurn && game.drawPile.length > 0 ? 'visible' : 'hidden' }}
              >
                <button 
                  className="btn btn-score"
                  onClick={handleScoreClick}
                  disabled={!isMyTurn || game.drawPile.length === 0}
                >
                  Score
                </button>
                <button 
                  className="btn btn-steal"
                  onClick={handleStealClick}
                  disabled={!isMyTurn || game.drawPile.length === 0}
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
        {game.players.map((player, index) => {
          // Add ghost cards to this tank if they should be visible
          // For ghost card tank, filter out any cards that are already in ghost cards to avoid duplicates
          const cardsToDisplay = ghostCardsInTank.tankIndex === index 
            ? [
                ...player.tank.filter(card => 
                  !ghostCardsInTank.cards.some(gc => gc.id === card.id)
                ),
                ...ghostCardsInTank.cards
              ]
            : player.tank;
          
          // Pass through hiddenCardIds - ghost cards will be filtered by their IDs too
          const hiddenCardsForThisTank = hiddenCardIds;
          
          // Pass flipping cards only to the acting player's tank
          const flippingCardsForThisTank = index === actingPlayerIndex 
            ? flippingCardsInTank 
            : new Set();
          
          // Pass fading out cards only to the acting player's tank
          const fadingOutCardsForThisTank = index === actingPlayerIndex 
            ? fadingOutCardsInTank 
            : new Set();
          
          // Use frozen score during animation, otherwise use current score
          const displayedScore = frozenScoreCount[index] !== undefined 
            ? frozenScoreCount[index] 
            : player.scoreCount;
          
          return (
            <Tank
              key={player.id}
              id={`tank-${index}`}
              cards={cardsToDisplay}
              playerName={player.name}
              scoreCount={displayedScore}
              isCurrentTurn={displayCurrentPlayerIndex === index}
              isCurrentPlayer={isLocalMode ? (displayCurrentPlayerIndex === index) : (player.id === currentUserId)}
              isWinning={checkWinCondition(player.scoreCount, game.players.length)}
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
              onClick={() => setShowActionModal(false)}
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
