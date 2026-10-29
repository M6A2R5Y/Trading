# Econometric & Volatility Formulas Reference

## 1. Log Returns & Realized Volatility
- Log return at bar $t$:
  $$r_t = \ln\left(\frac{C_t}{C_{t-1}}\right)$$
- Unbiased sample variance:
  $$s^2 = \frac{1}{N - 1}\sum_{t=1}^{N}(r_t - \bar{r})^2$$

## 2. Range-Based Volatility Estimators
- **Parkinson High-Low Estimator**:
  $$\sigma_{\text{Parkinson}} = \sqrt{\frac{B}{4 N \ln 2}\sum_{t=1}^{N}\left(\ln\frac{H_t}{L_t}\right)^2}$$
- **Garman-Klass OHLC Estimator**:
  $$\sigma_{\text{GK}} = \sqrt{\frac{B}{N}\sum_{t=1}^{N}\left[\frac{1}{2}\left(\ln\frac{H_t}{L_t}\right)^2 - (2\ln 2 - 1)\left(\ln\frac{C_t}{O_t}\right)^2\right]}$$
  where $B$ is the number of bars per year.

## 3. Inverse-MSE Walk-Forward Ensemble
Given out-of-sample 1-step-ahead Mean Squared Errors $\text{MSE}_m$ for models $m \in \{\text{OLS}, \text{Holt-EWMA}, \text{AR(1)}\}$:
$$w_m = \frac{\text{MSE}_m^{-1}}{\sum_{k} \text{MSE}_k^{-1}}$$
$$\mu_{\text{ens}, h} = \sum_{m} w_m \mu_{m, h}, \qquad \sigma_{\text{ens}, h}^2 = \sum_{m} w_m\left(\sigma_{m, h}^2 + \mu_{m, h}^2\right) - \mu_{\text{ens}, h}^2$$
