import './Brand.css'

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="РУСПЛАСТЗАВОД — на главную">
      <img className="brand-symbol" src="/images/rpz-mark.svg" width="42" height="42" alt="" />
      <span className="brand-wordmark" aria-hidden="true">
        <span className="brand-name">РУСПЛАСТ</span>
        <span className="brand-descriptor">ЗАВОД</span>
      </span>
    </a>
  )
}
