import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowUpRight,
  ArrowRight,
  Flame,
  Heart,
  Timer,
  Pizza,
  MapPin,
  Leaf,
  ChefHat,
} from 'lucide-react';
import { MenuBrowser } from '@/components/menu-browser';
import { HomeCoupon } from '@/components/home-coupon';
import { HomeServiceFacts } from '@/components/home-service-facts';
export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="hero-kicker">
              <Flame size={14} /> A LITTLE HEAT. A WHOLE LOT OF HAPPY.
            </span>
            <h1>
              Life’s better
              <br />
              with a <em>slice.</em>
              <span className="headline-star">✳</span>
            </h1>
            <p>
              Fresh dough. Bold toppings. That perfect cheese pull.
              <br className="desktop-break" /> Your favourite kind of happiness, straight from our
              oven.
            </p>
            <div className="hero-actions">
              <Link href="/menu" className="btn btn-primary btn-large">
                Order online <ArrowUpRight size={20} />
              </Link>
              <Link href="/menu" className="hero-secondary">
                Browse menu <ArrowRight size={17} />
              </Link>
            </div>
            <HomeServiceFacts />
          </div>
          <div className="hero-visual">
            <div className="pizza-orbit" />
            <div className="hero-pizza-wrap">
              <Image
                className="hero-pizza"
                src="/images/hero-paneer-pizza.jpg"
                alt="Paneer pizza with capsicum and melted cheese"
                fill
                sizes="(max-width: 370px) 280px, (max-width: 700px) 319px, (max-width: 900px) 330px, (max-width: 1150px) 390px, (min-width: 1500px) 495px, 450px"
                loading="eager"
                fetchPriority="high"
              />
            </div>
            <div className="fresh-stamp">
              FRESH DOUGH<span>✳</span>BIG FLAVOURS
            </div>
            <span className="cheese-note">
              love at first bite <span>↴</span>
            </span>
            <div className="hero-float">
              <span className="float-icon">
                <Flame size={23} />
              </span>
              <div>
                Hot from the oven<strong>Made fresh. Just for you.</strong>
              </div>
              <span className="float-star">✦</span>
            </div>
            <div className="floating-basil">✦</div>
          </div>
        </div>
        <div className="container hero-perks">
          <span>
            <Timer size={19} />
            Fresh, fast & full of flavour
          </span>
          <span>
            <ChefHat size={19} />
            Hand-tossed with love
          </span>
          <span>
            <Heart size={19} />
            Quality in every bite
          </span>
        </div>
      </section>
      <div className="brand-ticker" aria-hidden="true">
        <span>GOOD FOOD</span>
        <span>✳</span>
        <span>GREAT MOOD</span>
        <span>✳</span>
        <span>BIG FLAVOURS</span>
        <span>✳</span>
        <span>ZERO BORING BITES</span>
        <span>✳</span>
        <span>GOOD FOOD</span>
        <span>✳</span>
        <span>GREAT MOOD</span>
      </div>
      <MenuBrowser home />
      <section className="offers-section container" id="offers">
        <div className="offer-main">
          <div>
            <span className="offer-eyebrow">MORE TO SHARE. MORE TO LOVE.</span>
            <h2>
              Bring the gang.
              <br />
              We’ll bring <em>the good stuff.</em>
            </h2>
            <p>
              Pizza, sides, and something fizzy. Find your perfect
              <br />
              match in our made-for-sharing combos.
            </p>
            <Link href="/menu?category=combos" className="btn btn-yellow">
              Find your combo <ArrowUpRight size={19} />
            </Link>
            <span className="offer-squiggle">a slice for everyone ↗</span>
          </div>
          <img src="/images/combo.jpg" alt="Pizza and delicious sides to share" />
        </div>
        <HomeCoupon />
      </section>
      <section className="love-section container">
        <span className="eyebrow">THERE’S A LITTLE ACE IN EVERY SLICE</span>
        <h2>
          Good pizza.
          <br />
          <em>No shortcuts.</em>
        </h2>
        <div className="love-grid">
          <div>
            <span>
              <Pizza size={29} />
            </span>
            <h3>From dough to delicious</h3>
            <p>
              Hand-tossed bases, a beautiful bake, and the kind of crust you save the last bite for.
            </p>
          </div>
          <div>
            <span>
              <Leaf size={29} />
            </span>
            <h3>Fresh is our favourite</h3>
            <p>Colourful toppings, bold flavours, and plenty of good things in every bite.</p>
          </div>
          <div>
            <span>
              <MapPin size={29} />
            </span>
            <h3>Your place or ours?</h3>
            <p>Cosy night in or a quick takeaway. Choose delivery or pickup at checkout.</p>
          </div>
        </div>
      </section>
    </>
  );
}
