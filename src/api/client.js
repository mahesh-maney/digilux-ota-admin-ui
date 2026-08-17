import axios from 'axios';
import { API_BASE } from '../config';

export const apiClient = (token, onUnauthorized) => {
  const instance = axios.create({
    baseURL: API_BASE,
    headers: { Authorization: token },
  });

  instance.interceptors.response.use(
    res => res,
    err => {
      if (err.response?.status === 401 && onUnauthorized) {
        onUnauthorized();
      }
      return Promise.reject(err);
    },
  );

  return instance;
};
