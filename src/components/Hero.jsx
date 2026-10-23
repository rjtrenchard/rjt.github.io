import { Link } from 'react-router-dom'
import HeroCube from './HeroCube';

export default function Hero() {
  return (
    <section id="hero" className="hero">
      <div className="hero-text">
        <p className="hero-greeting">Hi, my name is</p>
        <h1 className="hero-name">RJ.</h1>
        <h2 className="hero-title">I like building software.</h2>
        <p className="hero-desc">
          I&rsquo;m a software engineer based in Seattle. A bachelors in
          Software Development from Green River College, I have both personal,
          academic, and professional experience across the stack. Thanks for
          looking at my homepage.
        </p>
        <div className="hero-cta">
          <a href="#projects" className="btn btn-primary">View my work</a>
          <Link to="/hobbies" className="btn btn-outline">Check out my Hobbies</Link>
          <a href="#contact" className="btn btn-outline">Get in touch</a>
        </div>
      </div>

      <div className="hero-image">
        <HeroCube />
      </div>
    </section>
  )
}
