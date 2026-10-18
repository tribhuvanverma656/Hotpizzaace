import { Instagram, Facebook } from 'lucide-react';
export function SocialLinks() {
  return (
    <div className="restaurant-social-links" aria-label="Follow Hot Pizza Ace">
      <a href="https://www.instagram.com/hotpizzaace/" target="_blank" rel="noopener noreferrer">
        <Instagram size={17} /> Instagram
      </a>
      <a href="https://www.facebook.com/hotpizzaace/" target="_blank" rel="noopener noreferrer">
        <Facebook size={17} /> Facebook
      </a>
    </div>
  );
}
