import './Footer.css';

const Footer = () => {
  return (
    <footer className="app-footer">
      <p>
        This is a non-commercial demo by Brian Einstein Lassiter based on the Mantis card game by Exploding Kittens.{' '}
        <a 
          href="https://www.explodingkittens.com/products/mantis" 
          target="_blank" 
          rel="noopener noreferrer"
        >
          Please buy the game from them!
        </a>
      </p>
      <p>
        Source code available at{' '}
        <a 
          href="https://github.com/belassiter/mantid" 
          target="_blank" 
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </p>
    </footer>
  );
};

export default Footer;
