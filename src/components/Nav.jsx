import { useState, useEffect } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

export default function Nav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  // Close menu on route change
  useEffect(() => { setOpen(false) }, [location])

  return (
    <nav className="nav">
      <Link to="/" className="nav-logo">RJ</Link>

      <button
        className={`nav-hamburger${open ? ' nav-hamburger--open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
      >
        <span /><span /><span />
      </button>

      <ul className={`nav-links${open ? ' nav-links--open' : ''}`} onClick={() => setOpen(false)}>
        <li><a href={`${import.meta.env.BASE_URL}#about`}>About</a></li>
        <li><a href={`${import.meta.env.BASE_URL}#projects`}>Projects</a></li>
        <li>
          <NavLink
            to="/hobbies"
            className={({ isActive }) => isActive ? 'nav-active' : ''}
          >
            Hobbies
          </NavLink>
        </li>
        <li><a href={`${import.meta.env.BASE_URL}#contact`}>Contact</a></li>
        <li><a href="https://www.github.com/rjtrenchard" target="_blank" rel="noopener noreferrer">GitHub</a></li>
        <li><a href="https://www.linkedin.com/in/rj-trenchard" target="_blank" rel="noopener noreferrer">LinkedIn</a></li>
      </ul>
    </nav>
  )
}
