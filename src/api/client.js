import axios from 'axios';
import { API_BASE } from '../config';

export const apiClient = (token) =>
  axios.create({
    baseURL: API_BASE,
    headers: { Authorization: token },
  });
